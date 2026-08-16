import type { EventBridgeEvent } from 'aws-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StartTranscriptionJobCommand, TranscribeClient } from '@aws-sdk/client-transcribe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { analyzeTranscribeResult, type TranscribeResult } from '@bilingual-app/analysis';
import { recordingId } from '../shared/http.js';

const s3 = new S3Client({});
const transcribe = new TranscribeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME!;
const RECORDINGS_TABLE_NAME = process.env.RECORDINGS_TABLE_NAME!;
const ANALYSIS_RESULTS_TABLE_NAME = process.env.ANALYSIS_RESULTS_TABLE_NAME!;
const CHILDREN_TABLE_NAME = process.env.CHILDREN_TABLE_NAME!;

/**
 * ジョブ失敗時の自動リトライ回数(要件定義書 5.3章「Transcribeジョブ失敗時のハンドリング」)。
 * MVPでは指数バックオフの遅延キューまでは組まず即時リトライとしている。頻繁に失敗するようであれば
 * EventBridge Scheduler等での遅延リトライへの置き換えを検討する。
 */
const MAX_RETRIES = 3;

interface TranscribeJobStateChangeDetail {
  TranscriptionJobName: string;
  TranscriptionJobStatus: 'COMPLETED' | 'FAILED';
  FailureReason?: string;
}

async function readTranscribeOutput(key: string): Promise<TranscribeResult> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: MEDIA_BUCKET_NAME, Key: key }));
  const text = await obj.Body!.transformToString('utf-8');
  return JSON.parse(text) as TranscribeResult;
}

/**
 * Transcribeジョブの完了/失敗を検知し、分析結果の保存またはリトライを行う
 * (要件定義書 5.3章手順4-5、6章の各種指標算出)。
 * EventBridgeルール(source: aws.transcribe, detail-type: "Transcribe Job State Change")で起動。
 */
export const handler = async (
  event: EventBridgeEvent<'Transcribe Job State Change', TranscribeJobStateChangeDetail>,
): Promise<void> => {
  const { TranscriptionJobName: jobName, TranscriptionJobStatus: status } = event.detail;

  const match = jobName.match(/^([^_]+)_([^_]+)_en_(\d+)$/);
  if (!match) {
    console.warn(`skip: job name does not match expected pattern: ${jobName}`);
    return;
  }
  const [, childId, date] = match;

  const recording = await ddb.send(
    new GetCommand({ TableName: RECORDINGS_TABLE_NAME, Key: { childId, date } }),
  );
  if (!recording.Item) {
    console.warn(`skip: no DailyRecording found for ${childId}/${date}`);
    return;
  }

  // 同日に2回以上アップロードされた場合、on-video-uploaded側で新しいジョブに差し替わっている
  // (transcribeJobNameが更新される)ため、受け取ったこのイベントが古いジョブのものであれば無視する
  // (常に最新のアップロードを採用する。実機フィードバックにより追加)。
  if (recording.Item.transcribeJobName !== jobName) {
    console.warn(
      `skip: stale transcribe job event (${jobName}); current job for ${childId}/${date} is ${recording.Item.transcribeJobName}`,
    );
    return;
  }

  if (status === 'FAILED') {
    const retryCount = (recording.Item.retryCount as number | undefined) ?? 0;
    if (retryCount < MAX_RETRIES) {
      const newJobName = `${childId}_${date}_en_${Date.now()}`;
      const key = recording.Item.videoKeyEn as string;
      const outputKey = `transcribe-output/${childId}/${date}/${newJobName}.json`;
      await transcribe.send(
        new StartTranscriptionJobCommand({
          TranscriptionJobName: newJobName,
          LanguageCode: 'en-US',
          Media: { MediaFileUri: `s3://${MEDIA_BUCKET_NAME}/${key}` },
          OutputBucketName: MEDIA_BUCKET_NAME,
          OutputKey: outputKey,
          // 初回起動(on-video-uploaded)と同じ設定を維持する
          Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 2 },
        }),
      );
      await ddb.send(
        new UpdateCommand({
          TableName: RECORDINGS_TABLE_NAME,
          Key: { childId, date },
          UpdateExpression: 'SET transcribeJobName = :jobName, retryCount = :retryCount',
          ExpressionAttributeValues: { ':jobName': newJobName, ':retryCount': retryCount + 1 },
        }),
      );
    } else {
      // 5.3章: リトライ上限に達した場合はfailedのまま保護者モードで手動確認できるようにする
      await ddb.send(
        new UpdateCommand({
          TableName: RECORDINGS_TABLE_NAME,
          Key: { childId, date },
          UpdateExpression: 'SET #status = :failed',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':failed': 'failed' },
        }),
      );
    }
    return;
  }

  // COMPLETED
  const outputKey = `transcribe-output/${childId}/${date}/${jobName}.json`;
  const transcribeResult = await readTranscribeOutput(outputKey);

  const childItem = await ddb.send(
    new GetCommand({ TableName: CHILDREN_TABLE_NAME, Key: { childId } }),
  );
  const priorLemmas = new Set<string>((childItem.Item?.cumulativeLemmas as string[] | undefined) ?? []);

  const durationSecEn = (recording.Item.durationSecEn as number | undefined) ?? 0;
  const analysis = analyzeTranscribeResult({
    transcribeResult,
    durationSec: durationSecEn,
    priorLemmas,
  });

  // 話者分離が有効な場合、analysis.transcriptは発話時間の長い話者(子供と推定)の発話だけに
  // 絞り込んだ文字列になっている(親の声が混入していても分析・表示から除外される)
  await ddb.send(
    new PutCommand({
      TableName: ANALYSIS_RESULTS_TABLE_NAME,
      Item: {
        recordingId: recordingId(childId, date),
        childId,
        date,
        durationSec: analysis.durationSec,
        wordCount: analysis.wordCount,
        uniqueWordCount: analysis.uniqueWordCount,
        newWordCount: analysis.newWordCount,
        cumulativeUniqueWordCount: analysis.cumulativeUniqueWordCount,
        wordsPerMinute: analysis.wordsPerMinute,
        typeTokenRatio: analysis.typeTokenRatio,
        sentenceCount: analysis.sentenceCount,
        avgSentenceLength: analysis.avgSentenceLength,
        pauseCount: analysis.pauseCount,
        totalPauseSec: analysis.totalPauseSec,
        // ダッシュボードで「何を話して何が新出語彙としてカウントされたか」をハイライト表示するために保存
        newLemmas: analysis.newLemmas,
      },
    }),
  );

  await ddb.send(
    new UpdateCommand({
      TableName: RECORDINGS_TABLE_NAME,
      Key: { childId, date },
      UpdateExpression: 'SET #status = :analyzed, transcriptEn = :transcript',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':analyzed': 'analyzed', ':transcript': analysis.transcript },
    }),
  );

  if (analysis.sessionLemmas.length > 0) {
    await ddb.send(
      new UpdateCommand({
        TableName: CHILDREN_TABLE_NAME,
        Key: { childId },
        UpdateExpression: 'ADD cumulativeLemmas :newLemmas',
        ExpressionAttributeValues: { ':newLemmas': new Set(analysis.sessionLemmas) },
      }),
    );
  }
};
