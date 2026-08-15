# app/

フロントエンド(子供向け録画UI・保護者ダッシュボード)です。React + Vite + TypeScript。
機能の背景は [`../docs/requirements.md`](../docs/requirements.md) の5章(機能要件)を参照してください。
操作イメージのモックは [`../docs/prototype.html`](../docs/prototype.html)(データ保存なしの単一HTMLプロトタイプ)。

## 実装内容

- `/login` — 保護者モードの共有ログイン(Cognito)
- `/` — 子供選択(ホーム)
- `/record/:childId` — 日本語→英語の動画回答フロー(`getUserMedia`によるアプリ内録画)→S3 Presigned URLアップロード→分析待ち→結果表示
- `/dashboard/:childId` — 英語で話せた時間・発話速度・語彙多様度・ポーズ等の推移グラフ、記録一覧
- `/parent` — 子供プロフィール管理(名前・生年月日・顔写真)

## セットアップ

リポジトリルートでworkspace一括インストールします(app単体では動きません)。

```bash
# リポジトリルートで
npm install
cp app/.env.example app/.env.local   # infra/ のcdk deploy出力値を設定
npm run dev -w app
```

## よく使うコマンド(app/ 配下で実行)

```bash
npm run dev     # 開発サーバー
npm run lint    # oxlint
npm test        # vitest
npm run build   # 型チェック + 本番ビルド(dist/へ出力。infra側でS3静的ホスティングに同期する想定)
```

## 環境変数(`app/.env.local`。`.env.example`参照)

- `VITE_API_BASE_URL` — infra側のHTTP APIエンドポイント(`cdk deploy`のCfnOutput `ApiUrl`)
- `VITE_COGNITO_USER_POOL_ID` — CfnOutput `UserPoolId`
- `VITE_COGNITO_USER_POOL_CLIENT_ID` — CfnOutput `UserPoolClientId`

## 未実装・今後の課題

- 保護者モードのCognito認証は実装済みだが、パスワードリセットUIは未実装(AWSコンソール/CLIで対応する運用)
- オフライン時のアップロード再試行キューは未実装(ネットワーク切断時はエラー表示のみ)
