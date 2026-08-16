import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { errorResponse, jsonResponse } from '../shared/http.js';

// requestChecksumCalculation: 'WHEN_REQUIRED' を指定しないと、SDK v3のデフォルト('WHEN_SUPPORTED')が
// PutObjectCommandの署名にx-amz-checksum-crc32等を自動付与してしまう。presign時点ではボディが
// 空のため空文字のCRC32が焼き込まれ、クライアントが実際の(空でない)動画blobをPUTすると
// チェックサム不一致でS3が403を返す(実機検証で確認済み)。
const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' });
const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME!;

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

interface PresignRequestBody {
  kind: 'video' | 'photo';
  contentType: string;
  /** kind='video'の場合に必須。録画時間(秒)。5.1章のクライアント側録画タイマーから取得 */
  durationSec?: number;
  /** kind='video'の場合に必須 */
  childId?: string;
  /** kind='video'の場合に必須。Central Time基準の日付文字列(YYYY-MM-DD) */
  date?: string;
  /** kind='video'の場合に必須 */
  lang?: 'ja' | 'en';
  /** kind='photo'の場合に必須 */
  photoChildId?: string;
}

/**
 * S3へのPresigned PUT URLを発行する(要件定義書 5.2章)。
 * クライアントから直接S3へアップロードできるようにし、バックエンド経由の転送コストを避ける。
 *
 * キー設計: 要件定義書のキー例(`<childId>/<date>/<lang>.mp4`)を踏襲しつつ、
 * S3イベント通知でのフィルタリングを容易にするため `recordings/` プレフィックスを付与している
 * (`recordings/<childId>/<date>/<lang>.<ext>`)。写真は `photos/<childId>.<ext>`。
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  let body: PresignRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return errorResponse(400, 'invalid JSON body');
  }

  const ext = CONTENT_TYPE_TO_EXT[body.contentType];
  if (!ext) {
    return errorResponse(400, `unsupported contentType: ${body.contentType}`);
  }

  let key: string;
  const metadata: Record<string, string> = {};

  if (body.kind === 'photo') {
    if (!body.photoChildId) return errorResponse(400, 'photoChildId is required for kind=photo');
    key = `photos/${body.photoChildId}.${ext}`;
  } else if (body.kind === 'video') {
    if (!body.childId || !body.date || !body.lang) {
      return errorResponse(400, 'childId, date, lang are required for kind=video');
    }
    if (body.lang !== 'ja' && body.lang !== 'en') {
      return errorResponse(400, 'lang must be "ja" or "en"');
    }
    if (typeof body.durationSec !== 'number' || body.durationSec < 0) {
      return errorResponse(400, 'durationSec (seconds, >= 0) is required for kind=video');
    }
    key = `recordings/${body.childId}/${body.date}/${body.lang}.${ext}`;
    // 録画時間はTranscribe不要でLambda側の録画メタデータだけで算出できる指標(要件定義書6章)。
    // アップロード時にS3オブジェクトメタデータとして埋め込み、on-video-uploadedで読み取る。
    metadata.durationsec = String(body.durationSec);
  } else {
    return errorResponse(400, 'kind must be "video" or "photo"');
  }

  const command = new PutObjectCommand({
    Bucket: MEDIA_BUCKET_NAME,
    Key: key,
    ContentType: body.contentType,
    Metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  // 注意: `Metadata`(x-amz-meta-*)はgetSignedUrlが生成するpresigned URLの署名済みクエリ
  // パラメータに既に組み込まれている(SigV4のヘッダーhoisting)。にもかかわらずクライアントが
  // 同じ値をリクエストヘッダーとしても送ると、そのヘッダーは署名対象(X-Amz-SignedHeaders)に
  // 含まれていないため、S3が「署名されていないヘッダーがある」として403 AccessDeniedを返す
  // (実機検証で確認済み)。よってrequiredHeadersにはContent-Typeのみを含める。
  const requiredHeaders: Record<string, string> = { 'Content-Type': body.contentType };

  return jsonResponse(200, { uploadUrl, key, requiredHeaders });
}
