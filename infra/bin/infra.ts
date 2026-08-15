#!/usr/bin/env node
import 'source-map-support/register.js';
import * as cdk from 'aws-cdk-lib';
import { BilingualAppStack } from '../lib/bilingual-app-stack.js';
import { GitHubOidcStack } from '../lib/github-oidc-stack.js';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-2',
};

new BilingualAppStack(app, 'BilingualAppStack', {
  env,
  description: 'Bilingual App (要件定義書 v1.7) - 家庭用の英語習得記録アプリのコスト最小AWS構成',
  // AWS Budgetsの通知先メールアドレス。`cdk deploy -c budgetAlertEmail=you@example.com`
  // または cdk.json の context で指定する(8.4章「コスト監視」)。未指定時は通知なしでBudgetのみ作成する
  budgetAlertEmail: app.node.tryGetContext('budgetAlertEmail') as string | undefined,
});

// GitHub Actionsからのデプロイ用OIDCロール(要件定義書8.5章)。
// このスタックだけはTakashiさんが自分のAWS管理者権限で手動デプロイする(CI/CD自身の認証手段を
// CI/CDには作らせない)。`cdk deploy GitHubOidcStack -c githubRepo=owner/repo` で明示的に指定する。
const githubRepo = (app.node.tryGetContext('githubRepo') as string | undefined) ?? 'higashizono33/bilingual-app';
new GitHubOidcStack(app, 'GitHubOidcStack', {
  env,
  description: 'GitHub Actions用のOIDC IDプロバイダ + デプロイ用IAMロール(手動デプロイ専用)',
  githubRepo,
});
