# Bilingual App

お子様2名（長男7歳・次男5歳）の日本語・英語のバイリンガルレベルを、家庭内で毎日記録・可視化するための Web アプリのプロジェクトです。

## 目的

10月の米国（シカゴ近郊）帰国・移住を控え、現時点で英語をほぼ話せない子供2人（7歳・5歳）が渡米後どう英語を伸ばしていくかを、日々の動画記録とAI分析で定点観測する。学術的・臨床的な言語診断の代替ではなく、あくまで家庭用の記録・可視化ツール。

## 現在のスコープ（v1.7 — 要件定義確定・実装中）

- **コア運用フロー**: 毎日「今日は何をした？」を**日本語→英語の順**で質問し、子供が動画で回答（iPad/iPhoneのアプリ内カメラでその場で撮影・アップロード）
- 動画は Amazon S3 に保存（mp4を標準フォーマット、Chromium系ブラウザ利用時はwebmフォールバック）。**英語の回答のみAI分析**（Amazon Transcribe）。日本語は参考記録として保存のみ
- **追跡指標**: 英語で話せた時間（最重要指標）、総発話語数、ユニーク語彙数（レンマ／word familyベース）、累積・新出語彙数、発話速度（WPM）、語彙多様度（Type-Token Ratio）、ポーズ（間）分析。単語ごとの信頼度スコアは誤解を招きやすいためMVPでは不採用
- 発音・アクセントの評価はAWS単独構成では不可能なためMVP対象外（将来Azure AI Speech Pronunciation Assessment等を検討）
- **AWS構成**: S3 + Lambda（S3イベント直起動） + Amazon Transcribe + DynamoDB（オンデマンド） + Cognito（家族共有ログイン） + S3静的ホスティング。EventBridge（Transcribe完了検知のみ仕様上必須）・NAT Gateway/VPC・CloudFront・SSE-KMSはコスト最小化のため不採用
- **バックアップ・コスト運用**: S3バージョニングは無効、MFA Deleteは有効化。AWS Budgetsで月間コスト監視
- **IaC / CI/CD**: AWS CDK（TypeScript）でインフラ定義、GitHub Actions + OIDC連携（長期アクセスキー不使用）でデプロイ自動化
- **タイムゾーン**: 渡米前の現時点から米国中部時間（Central Time）で統一
- 想定頻度: 毎日

詳細は [`requirements.md`](./requirements.md)（v1.7、要件定義の論点はすべて決定済み）を参照。

## ファイル構成

- `requirements.md` — 目的・対象ユーザー・コア運用フロー・機能要件・追跡指標・データモデル・AWSアーキテクチャなどの要件定義書（v1.7）
- `docs/prototype.html` — 日本語→英語の動画Q&Aフロー、子供の写真アバター、発話時間/WPM/語彙数/TTR/ポーズ分析の5指標ダッシュボードを再現した単一HTMLプロトタイプ（データ保存なしのモック。実装のUI/UX参考元）
- `docs/architecture.html` — AWSアーキテクチャ構成図（コスト最小構成）
- `packages/analysis/` — 語彙分析ロジック(レンマ化・WPM・TTR・ポーズ分析など。要件定義書6章)の共有パッケージ。Vitestでユニットテスト済み
- `infra/` — AWS CDK(TypeScript)によるインフラ定義一式(S3/DynamoDB/Lambda/Transcribe/Cognito/HTTP API/AWS Budgets)。詳細は [`infra/README.md`](./infra/README.md)
- `app/` — React + Vite + TypeScriptのフロントエンド(録画UI・ダッシュボード・保護者モード)。詳細は [`app/README.md`](./app/README.md)

## セットアップ(はじめて動かす場合)

npm workspaces構成のため、リポジトリルートで一括インストールします。

```bash
npm install
npm run build:analysis   # 共有ロジックを先にビルド(app/infraの両方から参照される)

# フロントエンドを動かす場合
cp app/.env.example app/.env.local   # infra/ のcdk deploy出力値を設定(未デプロイならダミー値でもUI確認は可能)
npm run dev -w app

# インフラのCloudFormationテンプレートを確認する場合(AWS認証情報不要)
npm run synth -w infra
```

実際にAWSへデプロイするには `infra/README.md` の手順(`cdk deploy`、保護者アカウントの作成)を参照してください。

## 今後のステップ

1. ~~`requirements.md` 10章のプロトタイプ範囲に沿った実装~~ → 完了(本README作成時点。`app/` `infra/` `packages/analysis/` に実装済み)
2. AWSアカウントへの実デプロイ(`cdk bootstrap` → `cdk deploy`)、GitHub Secretsの設定(`AWS_DEPLOY_ROLE_ARN`)、`.github/workflows/deploy.yml` の `if: false` 解除
3. 実機(iPad/iPhone)での動画録画・アップロード・Transcribe連携の動作確認
4. 渡米（10月）前にMVPを稼働させ、日々の記録を開始
