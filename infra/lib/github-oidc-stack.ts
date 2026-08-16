import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface GitHubOidcStackProps extends cdk.StackProps {
  /** "owner/repo" 形式(例: "higashizono33/bilingual-app") */
  githubRepo: string;
  /** このロールを引き受けられるブランチ。デフォルトはmainのみ(pushトリガーのデプロイに限定) */
  allowedBranch?: string;
  /**
   * GitHubの repository_owner_id (不変ID)。指定すると sub クレームの条件が
   * `repo:<owner>@<ownerId>/<repo>@<repoId>:ref:refs/heads/<branch>` という不変ID付き形式になる(GitHubがオーナー名/リポジトリ名の変更・譲渡耐性のために
   * 採用している新しいsubクレーム形式。実際にActions上で発行されるトークンの
   * `sub`をデコードして確認した値と一致させる必要がある)。
   * 未指定の場合は従来形式 `repo:<owner>/<repo>:ref:refs/heads/<branch>` を使う。
   */
  githubRepoOwnerId?: string;
  /** GitHubの repository_id (不変ID)。githubRepoOwnerIdとセットで指定する。 */
  githubRepoId?: string;
}

/**
 * GitHub Actionsからのデプロイ用OIDC連携(要件定義書8.5章で決定済み: 長期アクセスキーを
 * GitHub Secretsに置かず、GitHub OIDCでIAMロールを一時的にAssumeする方式)。
 *
 * このスタックは他のスタック(BilingualAppStack)をデプロイするためのIAMロールそのものを作るため、
 * GitHub Actions自身にはデプロイさせず、Takashiさんが自分のAWS管理者権限で手動デプロイする
 * (卵が先か鶏が先か問題。CI/CDが自分自身の認証手段は作れない)。
 *
 *   cdk deploy GitHubOidcStack -c githubRepo=higashizono33/bilingual-app
 *
 * 出力される DeployRoleArn を GitHub Secrets の AWS_DEPLOY_ROLE_ARN に設定する。
 *
 * 権限は「CDKブートストラップ済みのcdk-*ロールをAssumeできる」ことだけに絞っている。実際の
 * リソース作成権限はブートストラップ時に作られる cfn-exec-role 側にあり、GitHub Actions側の
 * ロールに広い権限を直接持たせない設計(AWS公式のCDK+GitHub OIDC構成に準拠)。
 */
export class GitHubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GitHubOidcStackProps) {
    super(scope, id, props);

    const allowedBranch = props.allowedBranch ?? 'main';

    // GitHubのsubクレームは `repo:OWNER/REPO:ref:refs/heads/BRANCH` という従来形式に加えて、
    // 不変ID付きの `repo:OWNER@OWNER_ID/REPO@REPO_ID:ref:refs/heads/BRANCH` 形式でも
    // 発行される場合がある(実際にActionsのログでOIDCトークンをデコードして確認した実測値に
    // 基づく)。githubRepoOwnerId/githubRepoIdが指定されていればそちらを使う。
    const [githubOwner, githubRepoName] = props.githubRepo.split('/');
    const subOwner = props.githubRepoOwnerId ? `${githubOwner}@${props.githubRepoOwnerId}` : githubOwner;
    const subRepo = props.githubRepoId ? `${githubRepoName}@${props.githubRepoId}` : githubRepoName;
    const subClaim = `repo:${subOwner}/${subRepo}:ref:refs/heads/${allowedBranch}`;

    // 1アカウントにつきGitHub用OIDCプロバイダは1つしか作成できない。
    // 既に他プロジェクトで作成済みの場合はこのブロックを削除し、
    // `iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(...)` で既存のものをimportすること。
    const provider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
      roleName: 'bilingual-app-github-actions-deploy',
      assumedBy: new iam.FederatedPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': subClaim,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      // IAM RoleのDescriptionはASCII(+Latin-1)のみ許可されるため日本語は使えない
      description: `Deploy role for GitHub Actions (${props.githubRepo}@${allowedBranch}) to deploy BilingualAppStack`,
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // CDKブートストラップ(cdk bootstrap)が作成する各種ロールをAssumeする権限のみを付与
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    );

    // deploy.yml内でスタック出力(ダッシュボードのバケット名)を取得するために必要
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadBilingualAppStackOutputs',
        actions: ['cloudformation:DescribeStacks'],
        resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/BilingualAppStack/*`],
      }),
    );

    // deploy.yml内でダッシュボードの静的ファイルをS3に同期(aws s3 sync)するために必要。
    // バケット名はStorageConstructで `bilingual-app-dashboard-<account>` に固定しているため、
    // ブートストラップ前でもこの時点でARNを組み立てられる
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SyncDashboardBucket',
        actions: ['s3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
        resources: [
          `arn:aws:s3:::bilingual-app-dashboard-${this.account}`,
          `arn:aws:s3:::bilingual-app-dashboard-${this.account}/*`,
        ],
      }),
    );

    // deploy.yml内でS3同期後にCloudFrontのキャッシュを無効化(invalidation)するために必要。
    // CloudFrontディストリビューションIDはBilingualAppStackデプロイ時に生成されるためARNを
    // 事前に組み立てられない(distribution部分はワイルドカードにする。アクション自体は
    // CreateInvalidationのみに絞っているため実害は小さい)
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'InvalidateDashboardDistribution',
        actions: ['cloudfront:CreateInvalidation'],
        resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
      }),
    );

    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
  }
}
