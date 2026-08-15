import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

/** 保護者モード配下のルートをCognito認証でゲートする(要件定義書5.5章) */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { loading, isAuthenticated } = useAuth();
  if (loading) return <main className="centered-page">読み込み中…</main>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
