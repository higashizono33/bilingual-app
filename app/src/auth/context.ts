import { createContext } from 'react';

export interface AuthContextValue {
  /** 初回セッション確認中かどうか(リロード直後の一瞬だけtrue) */
  loading: boolean;
  isAuthenticated: boolean;
  /** API呼び出しのAuthorizationヘッダーに使うIDトークン */
  idToken: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
