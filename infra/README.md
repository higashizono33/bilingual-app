# infra/

AWS CDK (TypeScript) によるインフラ定義です。構成方針は [`../docs/requirements.md`](../docs/requirements.md) の8章（AWSアーキテクチャ）を参照してください。

## 構成

- `bin/infra.ts` — CDK Appのエントリポイント
- `lib/bilingual-app-stack.ts` — スタック本体（Storage/Auth/Api/Budgetの各コンストラクトを合成）
- `lib/constructs/storage.ts` — S3（動画・写真・ダッシュボード静的サイト）、DynamoDB（Children/DailyRecordings/AnalysisResults）
- `lib/constructs/auth.ts` — Cognito User Pool（保護者モードの共有ログイン）
- `lib/constructs/api.ts` — Lambda関数群 + S3イベント通知 + Transcribe完了検知のEventBridgeルール + HTTP API(Cognito JWT認証)
- `lib/constructs/budget.ts` — AWS Budgetsによる月間コスト監視
- `lib/github-oidc-stack.ts` — GitHub Actions用のOIDC IDプロバイダ + デプロイ用IAMロール(下記「GitHub Actionsからのデプロイ設定」参照。手動デプロイ専用の別スタック)
- `lambda/` — 各Lambda関数のソース(TypeScript。`aws-cdk-lib/aws-lambda-nodejs`のesbuildバンドリングでデプロイ)
  - `presign-upload` — S3へのPresigned URL発行
  - `on-video-uploaded` — S3アップロードをトリガーにTranscribeジョブを開始(S3イベント)
  - `on-transcribe-job-state-change` — Transcribe完了/失敗のハンドリング、分析結果の保存、失敗時リトライ(EventBridge)
  - `get-history` — ダッシュボード用の履歴取得API
  - `children` — 子供プロフィール管理API
- `test/bilingual-app-stack.test.ts` / `test/github-oidc-stack.test.ts` — `aws-cdk-lib/assertions`によるスタックのユニットテスト

このCDK Appには2つの独立したスタックがあります(`npx cdk list`で確認可能):

- `BilingualAppStack` — アプリ本体(GitHub Actionsが継続的にデプロイする対象)
- `GitHubOidcStack` — 上記デプロイ用のIAMロールそのもの(後述の通りTakashiさんが手動で1回だけデプロイする)

語彙分析ロジック(レンマ化・WPM・TTR・ポーズ分析など)は `../packages/analysis` に切り出してあり、
`on-transcribe-job-state-change` Lambdaから `@bilingual-app/analysis` として参照しています。

## セットアップ

リポジトリルートでworkspace一括インストールします(infra単体では動きません)。

```bash
# リポジトリルートで
npm install
npm run build:analysis   # Lambdaが参照する@bilingual-app/analysisを先にビルド
```

## よく使うコマンド(infra/ 配下で実行)

```bash
npm run build                        # 型チェック
npm test                             # スタックのユニットテスト(aws-cdk-lib/assertions)
npm run synth                        # 全スタックのCloudFormationテンプレートを出力(Lambdaのesbuildバンドリングも実行される)
npx cdk deploy BilingualAppStack     # アプリ本体を実際にAWSへデプロイ(要: AWS認証情報)
```

`npx cdk synth` はAWS認証情報が無くてもローカルで実行できます(テンプレート生成のみ)。実際の`cdk deploy`にはAWS認証情報、および初回は`cdk bootstrap`が必要です。2スタック構成のため、`cdk deploy`実行時はスタック名(`BilingualAppStack`または`GitHubOidcStack`)を明示してください。

## GitHub Actionsからのデプロイ設定(要件定義書8.5章: OIDC連携)

長期アクセスキーをGitHub Secretsに置かず、GitHub OIDCでIAMロールを一時的にAssumeする方式(`GitHubOidcStack`)。
このロール自体はCI/CDが自分では作れない(卵が先か鶏が先か問題)ため、Takashiさんが自分のAWS管理者権限で
以下を1回だけ手動実行してください。

```bash
# 1. (初回のみ) CDKブートストラップ
npx cdk bootstrap aws://<AWSアカウントID>/us-east-2

# 2. GitHub OIDC用のIAMロールを作成(リポジトリ名はデフォルトでhigashizono33/bilingual-appを指す。
#    別のリポジトリ/ブランチを使う場合は -c githubRepo=owner/repo で上書き)
npx cdk deploy GitHubOidcStack

# 3. 出力される DeployRoleArn (例: arn:aws:iam::123456789012:role/bilingual-app-github-actions-deploy) を控える

# 4. (初回のみ、任意) アプリ本体も自分の権限で先にデプロイしておくとCI/CDが失敗しにくい
npx cdk deploy BilingualAppStack
```

続けて:

1. GitHubリポジトリの `Settings > Secrets and variables > Actions` に `AWS_DEPLOY_ROLE_ARN`(手順3のARN)を登録
   - 任意で `BUDGET_ALERT_EMAIL` も登録すると、AWS BudgetsのアラートをEmail購読する(8.4章)
2. `.github/workflows/deploy.yml` の `if: false` を外す
3. `main` へのpushで、以降は `BilingualAppStack` のみが自動デプロイされる(`GitHubOidcStack`はCI/CDの対象に含めていない)

既にAWSアカウントに別プロジェクト用の `token.actions.githubusercontent.com` OIDCプロバイダが存在する場合、
`cdk deploy GitHubOidcStack` は「プロバイダが既に存在する」旨のエラーになります。その場合は
`lib/github-oidc-stack.ts` の `new iam.OpenIdConnectProvider(...)` を、既存プロバイダをimportする
`iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(...)` に置き換えてください。

### AWS Budgetsの通知メール設定(任意)

```bash
npx cdk deploy -c budgetAlertEmail=you@example.com
```

未指定の場合はBudget自体は作成されますが、メール通知の購読は行われません(8.4章)。

### 保護者アカウントの作成(デプロイ後に1回だけ)

要件定義書5.5章の通り、サインアップ画面は用意していません。`cdk deploy`後、以下のように家族専用の1アカウントを手動作成してください。

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId のスタック出力> \
  --username you@example.com \
  --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true \
  --temporary-password '<仮パスワード>'
```

初回ログイン時に恒久パスワードへの変更が必要です(`aws cognito-idp admin-set-user-password --permanent`で先に恒久化することも可能)。

## 採用しているリソース(コスト最小構成)

- S3（動画本体、SSE-S3暗号化、アップロード1ヶ月後にGlacier Deep Archiveへライフサイクル移行。バージョニングは無効）
- DynamoDB（メタデータ・分析結果、オンデマンドモード）
- Lambda（S3イベント直接トリガーで分析パイプライン起動。Transcribe完了検知のみ仕様上EventBridge経由）
- Amazon Transcribe（英語動画の音声認識）
- Amazon Cognito（保護者モード共有ログイン）
- S3（非公開バケット。ダッシュボード=`app/`のビルド成果物を`aws s3 sync`で配置） + CloudFront（HTTPS配信。録画機能の`getUserMedia`がセキュアコンテキスト必須のため採用。独自ドメイン・ACM証明書なしで`*.cloudfront.net`のデフォルトドメインを使用）
- AWS Budgets（月間コスト監視）

NAT Gateway・VPCエンドポイント・API Gatewayの常時起動的な構成・SSE-KMSなど、常時課金が発生しうるリソースは家庭用途のデータ量では不要なため採用していません(CloudFrontのみ、HTTPS必須という機能要件のため例外的に採用。家族のみの低トラフィックで追加コストは僅少)。

GitHub ActionsからのデプロイはOIDC連携でIAMロールを一時的にAssumeする方式です（長期アクセスキーはGitHub Secretsに置かない。`.github/workflows/deploy.yml`参照）。
