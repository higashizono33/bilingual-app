import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

/**
 * 保護者モード認証(要件定義書 5.5章)。
 * 認証モデル: Takashiさん・奥様で共有ログイン(個別アカウントは作らない)。
 * 家族専用の1アカウントをCognitoで発行し、そのログイン情報を夫婦で共有する運用。
 * ユーザーの自己サインアップは無効化し、デプロイ後に管理者(cdk deploy実行者)が
 * `aws cognito-idp admin-create-user` で家族アカウントを1件だけ作成する想定。
 */
export class AuthConstruct extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'bilingual-app-family',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.userPoolClient = this.userPool.addClient('SpaClient', {
      authFlows: {
        // フロントエンド(SPA)からユーザー名/パスワードで直接サインインするフロー
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      accessTokenValidity: Duration.hours(12),
      idTokenValidity: Duration.hours(12),
      refreshTokenValidity: Duration.days(30),
    });
  }
}
