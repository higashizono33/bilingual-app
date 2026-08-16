import * as path from 'node:path';
import { Duration, Stack } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';
import type { AuthConstruct } from './auth.js';
import type { StorageConstruct } from './storage.js';

export interface ApiConstructProps {
  storage: StorageConstruct;
  auth: AuthConstruct;
}

const LAMBDA_DIR = path.join(__dirname, '..', '..', 'lambda');

/**
 * Lambda関数群 + S3イベントトリガー + Transcribe完了通知(EventBridge) + HTTP API を定義する。
 * 要件定義書 5.3章(AI分析パイプライン)・8.1章(コスト最小構成)に対応。
 * EventBridgeを挟まず無料枠の大きいLambda直起動を基本とするが、Transcribeジョブの完了通知だけは
 * AWSの仕様上EventBridge経由("Transcribe Job State Change"イベント)になる。
 */
export class ApiConstruct extends Construct {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    const { storage, auth } = props;
    const region = Stack.of(this).region;

    const commonEnv = {
      MEDIA_BUCKET_NAME: storage.mediaBucket.bucketName,
      CHILDREN_TABLE_NAME: storage.childrenTable.tableName,
      RECORDINGS_TABLE_NAME: storage.recordingsTable.tableName,
      ANALYSIS_RESULTS_TABLE_NAME: storage.analysisResultsTable.tableName,
    };

    const nodeJsFunctionDefaults: Partial<NodeJsFunctionPropsLike> = {
      runtime: lambda.Runtime.NODEJS_LATEST,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { minify: true, sourceMap: false, target: 'node22' },
    };

    // --- presign-upload: S3へのPresigned URL発行(要件定義書5.2章) ---
    const presignUploadFn = new NodejsFunction(this, 'PresignUploadFn', {
      ...nodeJsFunctionDefaults,
      entry: path.join(LAMBDA_DIR, 'presign-upload', 'index.ts'),
      environment: commonEnv,
    });
    storage.mediaBucket.grantPut(presignUploadFn);
    storage.mediaBucket.grantRead(presignUploadFn); // photo/videoのContent-Type検証等で将来利用する可能性に備える

    // --- on-video-uploaded: S3トリガーでTranscribe開始(要件定義書5.3章手順1-2) ---
    const onVideoUploadedFn = new NodejsFunction(this, 'OnVideoUploadedFn', {
      ...nodeJsFunctionDefaults,
      entry: path.join(LAMBDA_DIR, 'on-video-uploaded', 'index.ts'),
      environment: commonEnv,
      timeout: Duration.seconds(60),
    });
    storage.mediaBucket.grantRead(onVideoUploadedFn);
    // Transcribeの`OutputBucketName`指定時、出力JSONの書き込みは呼び出し元(このLambda)の
    // IAM権限で行われる。書き込み権限が無いと`StartTranscriptionJob`が
    // "The specified S3 bucket can't be accessed"で失敗する(実機検証で確認済み)
    storage.mediaBucket.grantPut(onVideoUploadedFn);
    storage.recordingsTable.grantReadWriteData(onVideoUploadedFn);
    onVideoUploadedFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['transcribe:StartTranscriptionJob'],
        resources: ['*'], // TranscriptionJobはARNでのリソース指定に対応していないため
      }),
    );

    // "recordings/<childId>/<date>/<lang>.<mp4|webm>" のPutObjectのみをトリガーにする
    storage.mediaBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_PUT,
      new s3n.LambdaDestination(onVideoUploadedFn),
      { prefix: 'recordings/', suffix: '.mp4' },
    );
    storage.mediaBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_PUT,
      new s3n.LambdaDestination(onVideoUploadedFn),
      { prefix: 'recordings/', suffix: '.webm' },
    );

    // --- on-transcribe-job-state-change: Transcribe完了/失敗のハンドリング(要件定義書5.3章手順3-5) ---
    const onTranscribeCompleteFn = new NodejsFunction(this, 'OnTranscribeCompleteFn', {
      ...nodeJsFunctionDefaults,
      entry: path.join(LAMBDA_DIR, 'on-transcribe-job-state-change', 'index.ts'),
      environment: commonEnv,
      timeout: Duration.seconds(60),
    });
    storage.mediaBucket.grantRead(onTranscribeCompleteFn);
    // リトライ時に自身もStartTranscriptionJobを呼ぶため、onVideoUploadedFnと同様に書き込み権限が必要
    storage.mediaBucket.grantPut(onTranscribeCompleteFn);
    storage.recordingsTable.grantReadWriteData(onTranscribeCompleteFn);
    storage.analysisResultsTable.grantReadWriteData(onTranscribeCompleteFn);
    storage.childrenTable.grantReadWriteData(onTranscribeCompleteFn);
    onTranscribeCompleteFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['transcribe:StartTranscriptionJob'],
        resources: ['*'],
      }),
    );

    new events.Rule(this, 'TranscribeJobStateChangeRule', {
      eventPattern: {
        source: ['aws.transcribe'],
        detailType: ['Transcribe Job State Change'],
        detail: { TranscriptionJobStatus: ['COMPLETED', 'FAILED'] },
      },
      targets: [new targets.LambdaFunction(onTranscribeCompleteFn)],
    });

    // --- get-history: ダッシュボード用の履歴取得API(要件定義書5.4章) ---
    const getHistoryFn = new NodejsFunction(this, 'GetHistoryFn', {
      ...nodeJsFunctionDefaults,
      entry: path.join(LAMBDA_DIR, 'get-history', 'index.ts'),
      environment: commonEnv,
    });
    storage.mediaBucket.grantRead(getHistoryFn);
    storage.recordingsTable.grantReadData(getHistoryFn);
    storage.analysisResultsTable.grantReadData(getHistoryFn);

    // --- children: 子供プロフィール管理API(要件定義書5.5章) ---
    const childrenFn = new NodejsFunction(this, 'ChildrenFn', {
      ...nodeJsFunctionDefaults,
      entry: path.join(LAMBDA_DIR, 'children', 'index.ts'),
      environment: commonEnv,
    });
    storage.mediaBucket.grantRead(childrenFn);
    storage.childrenTable.grantReadWriteData(childrenFn);

    // --- HTTP API (Cognito JWT認証。保護者モードの共有ログインでゲート: 要件定義書5.5章) ---
    const authorizer = new HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${region}.amazonaws.com/${auth.userPool.userPoolId}`,
      { jwtAudience: [auth.userPoolClient.userPoolClientId] },
    );

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.PUT, apigwv2.CorsHttpMethod.POST],
        allowHeaders: ['authorization', 'content-type'],
      },
      defaultAuthorizer: authorizer,
    });

    this.httpApi.addRoutes({
      path: '/uploads/presign',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('PresignUploadIntegration', presignUploadFn),
    });
    this.httpApi.addRoutes({
      path: '/children',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListChildrenIntegration', childrenFn),
    });
    this.httpApi.addRoutes({
      path: '/children/{childId}',
      methods: [apigwv2.HttpMethod.PUT],
      integration: new HttpLambdaIntegration('UpsertChildIntegration', childrenFn),
    });
    this.httpApi.addRoutes({
      path: '/children/{childId}/history',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetHistoryIntegration', getHistoryFn),
    });
  }
}

// NodejsFunctionPropsの一部だけを共通デフォルトとして使い回すためのゆるい型
type NodeJsFunctionPropsLike = {
  runtime: lambda.Runtime;
  architecture: lambda.Architecture;
  memorySize: number;
  timeout: Duration;
  bundling: { minify: boolean; sourceMap: boolean; target: string };
};
