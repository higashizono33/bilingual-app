import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { errorResponse, jsonResponse } from '../shared/http.js';

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME!;
const CHILDREN_TABLE_NAME = process.env.CHILDREN_TABLE_NAME!;

const PHOTO_URL_EXPIRES_IN = 60 * 60;

interface UpsertChildBody {
  name: string;
  birthdate: string;
  /** presign-uploadで kind=photo アップロード済みのS3キー(任意) */
  photoKey?: string;
}

/**
 * 子供プロフィール管理(要件定義書 5.5章)。
 * GET /children        - 一覧(顔写真は署名付きURLに変換して返す。未設定時はnull=プレースホルダー表示)
 * PUT /children/{childId} - 新規作成/更新(名前・生年月日・顔写真キー)
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;

  if (method === 'GET') {
    const result = await ddb.send(new ScanCommand({ TableName: CHILDREN_TABLE_NAME }));
    const children = await Promise.all(
      (result.Items ?? []).map(async (item) => ({
        childId: item.childId,
        name: item.name,
        birthdate: item.birthdate,
        photoUrl: item.photoKey
          ? await getSignedUrl(
              s3,
              new GetObjectCommand({ Bucket: MEDIA_BUCKET_NAME, Key: item.photoKey as string }),
              { expiresIn: PHOTO_URL_EXPIRES_IN },
            )
          : null,
      })),
    );
    return jsonResponse(200, { children });
  }

  if (method === 'PUT') {
    const childId = event.pathParameters?.childId;
    if (!childId) return errorResponse(400, 'childId path parameter is required');

    let body: UpsertChildBody;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return errorResponse(400, 'invalid JSON body');
    }
    if (!body.name || !body.birthdate) {
      return errorResponse(400, 'name and birthdate are required');
    }

    await ddb.send(
      new PutCommand({
        TableName: CHILDREN_TABLE_NAME,
        Item: {
          childId,
          name: body.name,
          birthdate: body.birthdate,
          ...(body.photoKey ? { photoKey: body.photoKey } : {}),
        },
      }),
    );
    return jsonResponse(200, { childId });
  }

  return errorResponse(405, `unsupported method: ${method}`);
}
