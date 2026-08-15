import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { listChildren } from '../api/client';
import type { Child } from '../types';
import { Avatar } from '../components/Avatar';

export function HomeScreen() {
  const { idToken, signOut } = useAuth();
  const navigate = useNavigate();
  const [children, setChildren] = useState<Child[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!idToken) return;
    listChildren(idToken)
      .then((res) => setChildren(res.children))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [idToken]);

  return (
    <main className="page">
      <header className="page-header">
        <h1>🌏 Bilingual App</h1>
        <button className="ghost-btn" onClick={signOut}>
          ログアウト
        </button>
      </header>

      <div className="card">
        <p className="tag">子供を選択</p>
        <h2>今日の記録をはじめる</h2>

        {error && <p className="error-text">{error}</p>}
        {!children && !error && <p className="muted">読み込み中…</p>}
        {children && children.length === 0 && (
          <p className="muted">
            まだ子供が登録されていません。<Link to="/parent">保護者モード</Link>から登録してください。
          </p>
        )}

        <div className="grid2">
          {children?.map((c) => (
            <div key={c.childId} className="tile" onClick={() => navigate(`/record/${c.childId}`)}>
              <Avatar photoUrl={c.photoUrl} name={c.name} size={72} />
              <div className="label">{c.name}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid2">
        {children?.map((c) => (
          <div
            key={c.childId}
            className="tile secondary"
            onClick={() => navigate(`/dashboard/${c.childId}`)}
          >
            📊 {c.name}のダッシュボード
          </div>
        ))}
      </div>

      <div className="card link-card" onClick={() => navigate('/parent')}>
        ⚙️ 保護者モード(子供の登録・写真設定)
      </div>
    </main>
  );
}
