import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

/**
 * 家族専用アプリのため、CORSはAPI Gateway側で許可済み(lib/constructs/api.ts)だが、
 * Lambda関数URL経由の呼び出しも想定してレスポンス側にも念のため付与する。
 */
export function jsonResponse(
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function errorResponse(statusCode: number, message: string): APIGatewayProxyStructuredResultV2 {
  return jsonResponse(statusCode, { error: message });
}

/** 5.1章: 質問は「今日は何をした?」に固定(MVPでは複数バリエーションは用意しない) */
export const DAILY_QUESTION = {
  ja: '今日は何をした?',
  en: 'What did you do today?',
};

/** recordingsTable/analysisResultsTableで使う複合ID */
export function recordingId(childId: string, date: string): string {
  return `${childId}#${date}`;
}
