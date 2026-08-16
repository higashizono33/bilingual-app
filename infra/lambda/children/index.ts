import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { errorResponse, jsonResponse } from '../shared/http.js';

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME!;
const CHILDREN_TABLE_NAME = process.env.CHILDREN_TABLE_NAME!;

const PHOTO_URL_EXPIRES_IN = 60 * 60;

interface UpsertChildBody {
  name?: string;
  birthdate?: string;
  /** presign-uploadで kind=photo アップロード済みのS3キー(任意) */
  photoKey?: string;
  /** ホーム画面での表示順(小さいほど先=左に表示。保護者モードの並び替えで送られる) */
  sortOrder?: number;
}

/**
 * 子供プロフィール管理(要件定義書 5.5章)。
 * GET /children        - 一覧(表示順=sortOrder昇順でソート。顔写真は署名付きURLに変換して返す。未設定時はnull=プレースホルダー表示)
 * PUT /children/{childId} - 新規作成/部分更新(name/birthdate/photoKey/sortOrderのうち送られたものだけを更新する。
 *                           全項目を毎回送る必要はない。以前はPutCommandで項目全体を上書きしていたため、
 *                           例えば名前だけ編集して保存すると既存のphotoKeyが消えてしまう不具合があった。
 *                           UpdateCommandで送られた属性だけをSETするよう修正)
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;

  if (method === 'GET') {
    const result = await ddb.send(new ScanCommand({ TableName: CHILDREN_TABLE_NAME }));
    const items = (result.Items ?? []).slice().sort((a, b) => {
      const orderA = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      // sortOrder未設定の子供同士は、結果が実行のたびにブレないようchildIdで安定ソートする
      return String(a.childId).localeCompare(String(b.childId));
    });

    const children = await Promise.all(
      items.map(async (item, index) => ({
        childId: item.childId,
        name: item.name,
        birthdate: item.birthdate,
        // DB上にsortOrderが無い子供(移行前のデータ)にも、並び替え前提でフロントに一貫した順位を返す
        sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index,
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

    const setClauses: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    if (body.name !== undefined) {
      setClauses.push('#name = :name');
      names['#name'] = 'name'; // "name"はDynamoDBの予約語のためExpressionAttributeNamesで回避
      values[':name'] = body.name;
    }
    if (body.birthdate !== undefined) {
      setClauses.push('birthdate = :birthdate');
      values[':birthdate'] = body.birthdate;
    }
    if (body.photoKey !== undefined) {
      setClauses.push('photoKey = :photoKey');
      values[':photoKey'] = body.photoKey;
    }
    if (body.sortOrder !== undefined) {
      setClauses.push('sortOrder = :sortOrder');
      values[':sortOrder'] = body.sortOrder;
    }

    if (setClauses.length === 0) {
      return errorResponse(400, 'at least one of name/birthdate/photoKey/sortOrder is required');
    }

    await ddb.send(
      new UpdateCommand({
        TableName: CHILDREN_TABLE_NAME,
        Key: { childId },
        UpdateExpression: `SET ${setClauses.join(', ')}`,
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ExpressionAttributeValues: values,
      }),
    );
    return jsonResponse(200, { childId });
  }

  return errorResponse(405, `unsupported method: ${method}`);
}
