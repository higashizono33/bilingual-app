import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StorageConstruct } from './constructs/storage.js';
import { AuthConstruct } from './constructs/auth.js';
import { ApiConstruct } from './constructs/api.js';
import { BudgetConstruct } from './constructs/budget.js';

export interface BilingualAppStackProps extends cdk.StackProps {
  /**
   * AWS Budgets(月間コスト監視)の通知先メールアドレス(要件定義書8.4章)。
   * 未指定の場合はBudgetは作成するが、メール通知の購読は行わない。
   */
  budgetAlertEmail?: string;
  /** 月間予算のしきい値(USD)。デフォルト $5(要件定義書8.4章の目安) */
  monthlyBudgetLimitUsd?: number;
}

/**
 * Bilingual App のAWSインフラ一式(要件定義書 v1.7 8章に対応)。
 * コスト最小構成を最優先: サーバーレス・オンデマンド課金のみで構成し、
 * NAT Gateway/VPCエンドポイント・CloudFront・API Gatewayの常時起動的な構成は採用しない。
 */
export class BilingualAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BilingualAppStackProps = {}) {
    super(scope, id, props);

    const storage = new StorageConstruct(this, 'Storage');
    const auth = new AuthConstruct(this, 'Auth');
    const api = new ApiConstruct(this, 'Api', { storage, auth });
    new BudgetConstruct(this, 'Budget', {
      alertEmail: props.budgetAlertEmail,
      monthlyLimitUsd: props.monthlyBudgetLimitUsd,
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'DashboardBucketWebsiteUrl', {
      value: storage.dashboardBucket.bucketWebsiteUrl,
    });
    new cdk.CfnOutput(this, 'DashboardBucketName', { value: storage.dashboardBucket.bucketName });
    new cdk.CfnOutput(this, 'MediaBucketName', { value: storage.mediaBucket.bucketName });
    new cdk.CfnOutput(this, 'UserPoolId', { value: auth.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: auth.userPoolClient.userPoolClientId });
  }
}
