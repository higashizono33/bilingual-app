import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { GitHubOidcStack } from '../lib/github-oidc-stack.js';

describe('GitHubOidcStack', () => {
  const app = new cdk.App();
  const stack = new GitHubOidcStack(app, 'TestGitHubOidcStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    githubRepo: 'higashizono33/bilingual-app',
  });
  const template = Template.fromStack(stack);

  it('token.actions.githubusercontent.com向けのOIDCプロバイダを作成する', () => {
    template.hasResourceProperties('Custom::AWSCDKOpenIdConnectProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIDList: ['sts.amazonaws.com'],
    });
  });

  it('mainブランチのpushからのみAssumeできるロールを作成する(要件定義書8.5章)', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'bilingual-app-github-actions-deploy',
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringLike: {
                'token.actions.githubusercontent.com:sub':
                  'repo:higashizono33/bilingual-app:ref:refs/heads/main',
              },
            },
          },
        ],
      },
    });
  });
});
