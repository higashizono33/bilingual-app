import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { config } from '../config';

/**
 * 保護者モードの共有ログイン(要件定義書5.5章)。
 * Takashiさん・奥様で1つのCognitoアカウントを共有する運用のため、
 * サインアップ画面は用意せずログインのみを実装する。
 */
const userPool = new CognitoUserPool({
  UserPoolId: config.cognitoUserPoolId,
  ClientId: config.cognitoUserPoolClientId,
});

export function signIn(email: string, password: string): Promise<CognitoUserSession> {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  const authDetails = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
      newPasswordRequired: () => {
        reject(
          new Error(
            '初回ログインにはパスワード変更が必要です。AWSコンソールまたはCLIで恒久パスワードを設定してください。',
          ),
        );
      },
    });
  });
}

export function getCurrentSession(): Promise<CognitoUserSession | null> {
  const user = userPool.getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err) return reject(err);
      resolve(session);
    });
  });
}

export function signOut(): void {
  userPool.getCurrentUser()?.signOut();
}
