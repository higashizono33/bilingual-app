import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { listChildren, presignUpload, upsertChild, uploadToPresignedUrl } from '../api/client';
import type { Child } from '../types';
import { Avatar } from '../components/Avatar';

/**
 * 保護者モード: 子供プロフィール管理(要件定義書5.5章)。
 * 子供の名前・生年月日・顔写真を登録/編集する。
 */
export function ParentModeScreen() {
  const { idToken } = useAuth();
  const navigate = useNavigate();
  const [children, setChildren] = useState<Child[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    if (!idToken) return;
    listChildren(idToken)
      .then((res) => setChildren(res.children))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(reload, [idToken]);

  return (
    <main className="page">
      <button className="back-link" onClick={() => navigate('/')}>
        ← ホームに戻る
      </button>
      <h1>⚙️ 保護者モード</h1>
      {error && <p className="error-text">{error}</p>}

      {children?.map((child) => (
        <ChildForm key={child.childId} child={child} idToken={idToken!} onSaved={reload} />
      ))}

      <ChildForm child={null} idToken={idToken!} onSaved={reload} />
    </main>
  );
}

function ChildForm({
  child,
  idToken,
  onSaved,
}: {
  child: Child | null;
  idToken: string;
  onSaved: () => void;
}) {
  const [childId, setChildId] = useState(child?.childId ?? '');
  const [name, setName] = useState(child?.name ?? '');
  const [birthdate, setBirthdate] = useState(child?.birthdate ?? '');
  const [photoUrl, setPhotoUrl] = useState(child?.photoUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingPhotoKey, setPendingPhotoKey] = useState<string | null>(null);

  async function onPhotoSelected(file: File) {
    setFormError(null);
    try {
      const { uploadUrl, key, requiredHeaders } = await presignUpload(idToken, {
        kind: 'photo',
        photoChildId: childId || crypto.randomUUID(),
        contentType: file.type,
      });
      await uploadToPresignedUrl(uploadUrl, file, requiredHeaders);
      setPendingPhotoKey(key);
      setPhotoUrl(URL.createObjectURL(file));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!childId) {
      setFormError('IDを入力してください(例: taro)');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await upsertChild(idToken, childId, {
        name,
        birthdate,
        ...(pendingPhotoKey ? { photoKey: pendingPhotoKey } : {}),
      });
      onSaved();
      if (!child) {
        setChildId('');
        setName('');
        setBirthdate('');
        setPendingPhotoKey(null);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <p className="tag">{child ? '編集' : '新しい子供を登録'}</p>
      <div className="avatar-wrap">
        <Avatar photoUrl={photoUrl} name={name || '?'} size={72} />
        <label className="avatar-edit-btn" title="写真を設定">
          📷
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onPhotoSelected(file);
            }}
          />
        </label>
      </div>

      {!child && (
        <label>
          ID(半角英数字。例: taro)
          <input value={childId} onChange={(e) => setChildId(e.target.value)} required />
        </label>
      )}
      <label>
        名前
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        生年月日
        <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} required />
      </label>

      {formError && <p className="error-text">{formError}</p>}
      <button className="primary-btn" type="submit" disabled={saving}>
        {saving ? '保存中…' : '保存'}
      </button>
    </form>
  );
}
