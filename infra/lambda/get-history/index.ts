import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { errorResponse, jsonResponse, recordingId } from '../shared/http.js';

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME!;
const RECORDINGS_TABLE_NAME = process.env.RECORDINGS_TABLE_NAME!;
const ANALYSIS_RESULTS_TABLE_NAME = process.env.ANALYSIS_RESULTS_TABLE_NAME!;

/** 動画再生用の署名付きURLの有効期限(秒)。ダッシュボードを開いている間視聴できれば十分な長さ */
const VIDEO_URL_EXPIRES_IN = 60 * 60;

/**
 * 子供ごとの日々の記録・分析結果の一覧を返す(要件定義書 5.4章「結果記録・可視化」)。
 * GET /children/{childId}/history
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const childId = event.pathParameters?.childId;
  if (!childId) return errorResponse(400, 'childId path parameter is required');

  const recordings = await ddb.send(
    new QueryCommand({
      TableName: RECORDINGS_TABLE_NAME,
      KeyConditionExpression: 'childId = :childId',
      ExpressionAttributeValues: { ':childId': childId },
    }),
  );

  const items = recordings.Items ?? [];

  const history = await Promise.all(
    items.map(async (rec) => {
      const analysis = await ddb.send(
        new GetCommand({
          TableName: ANALYSIS_RESULTS_TABLE_NAME,
          Key: { recordingId: recordingId(childId, rec.date as string) },
        }),
      );

      const videoUrlJa = rec.videoKeyJa
        ? await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: MEDIA_BUCKET_NAME, Key: rec.videoKeyJa as string }),
            { expiresIn: VIDEO_URL_EXPIRES_IN },
          )
        : null;
      const videoUrlEn = rec.videoKeyEn
        ? await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: MEDIA_BUCKET_NAME, Key: rec.videoKeyEn as string }),
            { expiresIn: VIDEO_URL_EXPIRES_IN },
          )
        : null;

      return {
        date: rec.date,
        questionText: rec.questionText,
        status: rec.status,
        videoUrlJa,
        videoUrlEn,
        durationSecJa: rec.durationSecJa ?? null,
        durationSecEn: rec.durationSecEn ?? null,
        transcriptEn: rec.transcriptEn ?? null,
        analysis: analysis.Item ?? null,
      };
    }),
  );

  history.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return jsonResponse(200, { childId, history });
}
