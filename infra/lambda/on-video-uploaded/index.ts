import type { S3Handler } from 'aws-lambda';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StartTranscriptionJobCommand, TranscribeClient } from '@aws-sdk/client-transcribe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DAILY_QUESTION } from '../shared/http.js';

const s3 = new S3Client({});
const transcribe = new TranscribeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME!;
const RECORDINGS_TABLE_NAME = process.env.RECORDINGS_TABLE_NAME!;

/**
 * S3への動画アップロード(PutObject)をトリガーに処理を開始する(要件定義書 5.3章 手順1-2)。
 * キー形式: `recordings/<childId>/<date>/<lang>.<mp4|webm>`
 *
 * - 言語が日本語(ja)の場合はここでスキップし、DailyRecordingの更新のみで完了(分析対象外)
 * - 言語が英語(en)の場合のみ、Amazon Transcribeの非同期ジョブを開始する
 */
export const handler: S3Handler = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    const match = key.match(/^recordings\/([^/]+)\/([^/]+)\/(ja|en)\.(mp4|webm)$/);
    if (!match) {
      console.warn(`skip: key does not match expected pattern: ${key}`);
      continue;
    }
    const [, childId, date, lang, format] = match;

    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const durationSecRaw = head.Metadata?.durationsec;
    const durationSec = durationSecRaw ? Number(durationSecRaw) : 0;

    if (lang === 'ja') {
      // 5.3章手順2: 日本語はここでスキップし、保存のみで完了
      await ddb.send(
        new UpdateCommand({
          TableName: RECORDINGS_TABLE_NAME,
          Key: { childId, date },
          UpdateExpression:
            'SET questionText = if_not_exists(questionText, :q), videoKeyJa = :key, videoFormatJa = :fmt, durationSecJa = :dur, #status = if_not_exists(#status, :uploaded)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':q': DAILY_QUESTION.en,
            ':key': key,
            ':fmt': format,
            ':dur': durationSec,
            ':uploaded': 'uploaded',
          },
        }),
      );
      continue;
    }

    // 英語動画: Transcribeジョブを開始(要件定義書 5.3章手順3)
    const jobName = `${childId}_${date}_en_${Date.now()}`;
    const outputKey = `transcribe-output/${childId}/${date}/${jobName}.json`;

    await transcribe.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        LanguageCode: 'en-US',
        Media: { MediaFileUri: `s3://${bucket}/${key}` },
        OutputBucketName: bucket,
        OutputKey: outputKey,
      }),
    );

    await ddb.send(
      new UpdateCommand({
        TableName: RECORDINGS_TABLE_NAME,
        Key: { childId, date },
        UpdateExpression:
          'SET questionText = if_not_exists(questionText, :q), videoKeyEn = :key, videoFormatEn = :fmt, durationSecEn = :dur, #status = :transcribing, transcribeJobName = :jobName, retryCount = if_not_exists(retryCount, :zero)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':q': DAILY_QUESTION.en,
          ':key': key,
          ':fmt': format,
          ':dur': durationSec,
          ':transcribing': 'transcribing',
          ':jobName': jobName,
          ':zero': 0,
        },
      }),
    );
  }
};
