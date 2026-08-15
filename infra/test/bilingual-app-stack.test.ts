import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BilingualAppStack } from '../lib/bilingual-app-stack.js';

describe('BilingualAppStack', () => {
  const app = new cdk.App();
  const stack = new BilingualAppStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('動画・写真用の非公開S3バケットを作成する(SSE-S3暗号化・バージョニング無効)', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
    });
  });

  it('DynamoDBテーブルをオンデマンド課金モードで3つ作成する(Children/DailyRecordings/AnalysisResults)', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 3);
    template.allResourcesProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('Cognito User Poolを1つ作成し、自己サインアップは無効化する', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  it('HTTP APIとLambda統合、Transcribe完了検知用のEventBridgeルールを作成する', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.resourceCountIs('AWS::Events::Rule', 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.transcribe'],
        'detail-type': ['Transcribe Job State Change'],
      },
    });
  });

  it('AWS Budgetsで月間コスト監視を設定する', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: { BudgetType: 'COST', TimeUnit: 'MONTHLY' },
    });
  });
});
