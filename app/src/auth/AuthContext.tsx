import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getCurrentSession, signIn as cognitoSignIn, signOut as cognitoSignOut } from './cognito';
import { AuthContext, type AuthContextValue } from './context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [idToken, setIdToken] = useState<string | null>(null);

  useEffect(() => {
    getCurrentSession()
      .then((session) => {
        if (session?.isValid()) {
          setIdToken(session.getIdToken().getJwtToken());
        }
      })
      .catch(() => {
        // 未ログイン、またはセッション切れ。ログイン画面へ誘導する
      })
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await cognitoSignIn(email, password);
    setIdToken(session.getIdToken().getJwtToken());
  }, []);

  const signOut = useCallback(() => {
    cognitoSignOut();
    setIdToken(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ loading, isAuthenticated: idToken !== null, idToken, signIn, signOut }),
    [loading, idToken, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
