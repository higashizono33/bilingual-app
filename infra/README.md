# infra/

AWS CDK (TypeScript) によるインフラ定義を配置するディレクトリです。

現時点ではまだ実装前（雛形のみ）です。構成方針は [`../docs/requirements.md`](../docs/requirements.md) の8章（AWSアーキテクチャ）を参照してください。

## 想定リソース（コスト最小構成）

- S3（動画本体、SSE-S3暗号化、アップロード1ヶ月後にGlacier Deep Archiveへライフサイクル移行）
- DynamoDB（メタデータ・分析結果、オンデマンドモード）
- Lambda（S3イベント直接トリガーで語彙分析、Transcribe連携）
- Amazon Transcribe（英語動画の音声認識）
- Amazon Cognito（保護者モード認証）
- S3静的ウェブサイトホスティング（ダッシュボード）

NAT Gateway・VPCエンドポイント・CloudFront・API Gatewayなど常時課金が発生しうるリソースは、家庭用途のデータ量では不要なため採用しない方針。

## セットアップ（本実装時）

```bash
npm install -g aws-cdk
cd infra
npm init -y
npm install aws-cdk-lib constructs
cdk init app --language typescript   # または手動でstackを作成
```

GitHub ActionsからのデプロイはOIDC連携でIAMロールを一時的にAssumeする方式を想定（長期アクセスキーはGitHub Secretsに置かない）。
