# bilingual-app

お子様2名（長男7歳・次男5歳）の日本語・英語のバイリンガルレベルを、家庭内で定期的に測定・記録・可視化するための Web アプリのプロジェクトです。

## 目的

10月の米国（シカゴ近郊）帰国・移住を控え、現時点で英語をほぼ話せない子供2人（7歳・5歳）が渡米後どう英語を伸ばしていくかを、日々の動画記録とAI分析で定点観測する。学術的・臨床的な言語診断の代替ではなく、あくまで家庭用の記録・可視化ツール。

## 現在のスコープ（v2）

- コア運用: 毎日「今日は何をした？」を日本語・英語それぞれで質問し、子供が動画で回答（日本語→英語の順）
- 動画は Amazon S3 にアップロード。**英語の回答のみ AI 分析**（語彙数・発話速度・語彙多様度などを継続記録）。日本語は参考記録として保存のみ
- AWS構成案: S3 + Transcribe（音声認識）+ Lambda（語彙分析）+ DynamoDB（結果蓄積）+ 将来的にBedrockでの定性評価
- 想定頻度: 毎日

詳細は [`docs/requirements.md`](./docs/requirements.md) を参照。

## リポジトリ構成（モノレポ）

```
bilingual-app/
├── app/     — フロントエンド（子供向け録画UI・保護者ダッシュボード）
├── infra/   — AWS CDK (TypeScript) によるインフラ定義
├── docs/    — 要件定義・アーキテクチャ図・プロトタイプ
└── .github/workflows/ — CI/CD (GitHub Actions)
```

開発者が自分1人の個人・家庭用プロジェクトのため、フロントとインフラは分割せず1リポジトリ内で管理する。

- [`docs/requirements.md`](./docs/requirements.md) — 目的・対象ユーザー・機能要件・非機能要件・評価基準・データモデルなどの要件定義
- [`docs/architecture.html`](./docs/architecture.html) — AWSアーキテクチャ図
- [`docs/prototype.html`](./docs/prototype.html) — 語彙テスト・スピーキングテスト・結果ダッシュボードの操作イメージが分かる単一HTMLのプロトタイプ（データ保存なしのモック）
- [`app/`](./app) — 本実装のフロントエンド（現在は雛形のみ）
- [`infra/`](./infra) — 本実装のAWS CDKインフラコード（現在は雛形のみ）

## 今後のステップ

1. 要件定義書のオープンな論点（12章）をレビュー・確定
2. 問題データ（単語リスト・お題リスト）の拡充
3. データ永続化・保護者モード認証を含む本実装の設計
4. `infra/` に AWS CDK (TypeScript) プロジェクトを構築
5. `app/` にフロントエンド実装（毎日の録画UI・ダッシュボード）を構築
6. GitHub Actions での CI/CD（OIDC連携でのAWSデプロイ）を有効化

## CI/CD

`main` ブランチへのマージで本番デプロイ、Pull Request で Lint/簡易テストを実行する方針（[`docs/requirements.md`](./docs/requirements.md) 8.5章）。AWSへの認証は長期アクセスキーを使わず GitHub OIDC で IAM ロールを一時的に Assume する。ワークフロー雛形は [`.github/workflows/`](./.github/workflows) を参照（実装が揃うまでは placeholder）。
