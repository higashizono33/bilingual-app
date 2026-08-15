import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * 保存レイヤー: S3(動画・写真・ダッシュボード静的サイト) + DynamoDB(メタデータ・分析結果)。
 * 要件定義書 7章(データモデル)・8章(AWSアーキテクチャ)に対応。
 */
export class StorageConstruct extends Construct {
  /** 動画(ja.mp4/en.mp4)・子供の顔写真を保存する非公開バケット */
  public readonly mediaBucket: s3.Bucket;
  /** ダッシュボード(React/Vite build成果物)を配信する静的ウェブサイトホスティング用バケット */
  public readonly dashboardBucket: s3.Bucket;

  public readonly childrenTable: dynamodb.Table;
  public readonly recordingsTable: dynamodb.Table;
  public readonly analysisResultsTable: dynamodb.Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // --- S3: 動画・写真(非公開、SSE-S3暗号化) ---
    // 要件定義書 5.2章・8.1章: バケットは非公開、SSE-S3で暗号化(SSE-KMSはコスト面で見送り)。
    // 8.4章: S3バージョニングは無効化(誤操作対策はMFA Delete + アプリから削除操作を提供しない運用で担保)。
    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'move-to-glacier-deep-archive-after-1-month',
          // 8.3章: アップロードから1ヶ月後にGlacier Deep Archiveへライフサイクル移行(決定済み)
          transitions: [
            {
              storageClass: s3.StorageClass.DEEP_ARCHIVE,
              transitionAfter: Duration.days(30),
            },
          ],
        },
      ],
    });

    // クライアント(ブラウザ)からPresigned URLで直接PUTアップロードできるようCORSを許可
    // (要件定義書 5.2章: Presigned URL方式。バックエンド経由の転送コストを避ける)
    this.mediaBucket.addCorsRule({
      allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
      allowedOrigins: ['*'],
      allowedHeaders: ['*'],
      exposedHeaders: ['ETag'],
      maxAge: 3000,
    });

    // --- S3: ダッシュボード静的ホスティング ---
    // 8.1章: CloudFrontは家族のみのアクセスなら不要。S3静的ウェブサイトホスティングのみで十分
    // バケット名は固定(`bilingual-app-dashboard-<account>`)にしている。GitHubOidcStack側のIAMポリシーで
    // (BilingualAppStackのデプロイ前でも)ARNを組み立てられるようにするため
    this.dashboardBucket = new s3.Bucket(this, 'DashboardBucket', {
      bucketName: `bilingual-app-dashboard-${Stack.of(this).account}`,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        blockPublicPolicy: false,
        ignorePublicAcls: true,
        restrictPublicBuckets: false,
      }),
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // --- DynamoDB(オンデマンドモード。8.1章: プロビジョニングのムダを排除) ---

    // Child: id(=childId), name, birthdate, photoUrl(S3キー), cumulativeLemmas(累積語彙のレンマ集合)
    this.childrenTable = new dynamodb.Table(this, 'ChildrenTable', {
      partitionKey: { name: 'childId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // DailyRecording: childId(PK), date(SK, Central Time基準の日付文字列)
    this.recordingsTable = new dynamodb.Table(this, 'DailyRecordingsTable', {
      partitionKey: { name: 'childId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // AnalysisResult: recordingId(PK) = `${childId}#${date}`。DailyRecordingと1:1
    this.analysisResultsTable = new dynamodb.Table(this, 'AnalysisResultsTable', {
      partitionKey: { name: 'recordingId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
