/**
 * デプロイ環境ごとの設定値。ビルド時にVite環境変数(`.env.local`等)から注入する。
 * 値はinfra側の `cdk deploy` 実行後に出力される CfnOutput (ApiUrl / UserPoolId / UserPoolClientId)
 * を `app/.env.local` に設定する運用を想定(`.env.example` 参照)。
 */
export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  cognitoUserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '',
  cognitoUserPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID ?? '',
  /**
   * 「今日」の日付境界に使うタイムゾーン。要件定義書9章(タイムゾーン決定済み):
   * 日本在住中も渡米後(米国中部時間)基準に最初から統一する。
   */
  appTimeZone: 'America/Chicago',
};
