import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { getHistory, presignUpload, uploadToPresignedUrl } from '../api/client';
import { RecordStep } from '../components/RecordStep';
import type { RecorderResult } from '../hooks/useRecorder';
import type { HistoryEntry } from '../types';
import { todayDateString } from '../utils/date';
import { DAILY_QUESTION } from '../constants';

type Phase = 'ja' | 'transition' | 'en' | 'uploading' | 'analyzing' | 'result' | 'upload-error';

/** 分析待ちのポーリング設定(要件定義書5.3章のTranscribe非同期ジョブを待つ) */
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

export function RecordScreen() {
  const { childId } = useParams<{ childId: string }>();
  const { idToken } = useAuth();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('ja');
  const [jaClip, setJaClip] = useState<RecorderResult | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ ja: number; en: number }>({ ja: 0, en: 0 });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [todayEntry, setTodayEntry] = useState<HistoryEntry | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const date = todayDateString();

  const uploadOne = useCallback(
    async (lang: 'ja' | 'en', clip: RecorderResult) => {
      if (!idToken || !childId) return;
      const { uploadUrl, requiredHeaders } = await presignUpload(idToken, {
        kind: 'video',
        childId,
        date,
        lang,
        contentType: clip.mimeType.split(';')[0],
        durationSec: clip.durationSec,
      });
      await uploadToPresignedUrl(uploadUrl, clip.blob, requiredHeaders, (pct) =>
        setUploadProgress((p) => ({ ...p, [lang]: pct })),
      );
    },
    [idToken, childId, date],
  );

  const startUpload = useCallback(
    async (enClip: RecorderResult) => {
      if (!jaClip) return;
      setPhase('uploading');
      setUploadError(null);
      try {
        await uploadOne('ja', jaClip);
        await uploadOne('en', enClip);
        setPhase('analyzing');
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : String(err));
        setPhase('upload-error');
      }
    },
    [jaClip, uploadOne],
  );

  // 分析待ちポーリング(要件定義書5.3章: Transcribe非同期ジョブの完了を待つ)
  useEffect(() => {
    if (phase !== 'analyzing' || !idToken || !childId) return;
    const startedAt = Date.now();

    async function poll() {
      if (!idToken || !childId) return;
      try {
        const { history } = await getHistory(idToken, childId);
        const entry = history.find((h) => h.date === date) ?? null;
        if (entry && (entry.status === 'analyzed' || entry.status === 'failed')) {
          setTodayEntry(entry);
          setPhase('result');
          return;
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          setTodayEntry(entry);
          setPhase('result'); // タイムアウト時も結果画面へ(分析中の表示のまま案内する)
          return;
        }
      } catch {
        // 一時的なネットワークエラーはポーリング継続で吸収する
      }
      pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    }
    poll();

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [phase, idToken, childId, date]);

  if (!childId) return null;

  return (
    <main className="page">
      <button className="back-link" onClick={() => navigate('/')}>
        ← 子供選択に戻る
      </button>

      <div className="card">
        <div className="step-track">
          <div className="step-dot-wrap">
            <div className={`step-dot ${jaClip ? 'done' : phase === 'ja' ? 'active' : ''}`} />
            <div className="step-dot-label">① 🇯🇵 日本語で回答</div>
          </div>
          <div className="step-arrow">→</div>
          <div className="step-dot-wrap">
            <div className={`step-dot ${phase === 'en' ? 'active' : ''}`} />
            <div className="step-dot-label">② 🇺🇸 英語で挑戦</div>
          </div>
        </div>

        {phase === 'ja' && (
          <RecordStep
            lang="ja"
            question={DAILY_QUESTION.ja}
            onUse={(result) => {
              setJaClip(result);
              setPhase('transition');
            }}
          />
        )}

        {phase === 'transition' && (
          <div className="center-col">
            <div className="bridge-emoji">🎉➡️🇺🇸</div>
            <p className="bridge-title">日本語での回答、ありがとう!</p>
            <p className="muted">
              じゃあ次は、同じことを英語で言ってみよう。
              <br />
              最初は数秒だけでも大丈夫。話せた時間もちゃんと記録するよ。
            </p>
            <button className="primary-btn" onClick={() => setPhase('en')}>
              🇺🇸 英語で挑戦する
            </button>
          </div>
        )}

        {phase === 'en' && (
          <RecordStep lang="en" question={DAILY_QUESTION.en} onUse={(result) => startUpload(result)} />
        )}

        {phase === 'uploading' && (
          <div className="center-col">
            <p className="tag">☁️ Amazon S3 へアップロード中</p>
            <h2>動画をアップロードしています…</h2>
            <ProgressBar label="日本語" percent={uploadProgress.ja} />
            <ProgressBar label="英語" percent={uploadProgress.en} />
          </div>
        )}

        {phase === 'upload-error' && (
          <div className="center-col">
            <p className="error-text">アップロードに失敗しました: {uploadError}</p>
            <button className="primary-btn" onClick={() => setPhase('uploading')}>
              もう一度試す
            </button>
          </div>
        )}

        {phase === 'analyzing' && (
          <div className="center-col">
            <p className="tag">⚡ Lambda → 🗣️ Amazon Transcribe</p>
            <h2>英語の回答を分析しています…</h2>
            <p className="muted">
              音声をテキスト化→語彙をレンマ単位でカウント/発話時間・発話速度・語彙多様度・間(ポーズ)を計測
            </p>
            <div className="spinner">⏳</div>
          </div>
        )}

        {phase === 'result' && (
          <ResultView childId={childId} entry={todayEntry} onDashboard={() => navigate(`/dashboard/${childId}`)} />
        )}
      </div>
    </main>
  );
}

function ProgressBar({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="progress-wrap">
      <p className="muted">{label}: {percent}%</p>
      <div className="progress-bar-bg">
        <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function ResultView({
  entry,
  onDashboard,
}: {
  childId: string;
  entry: HistoryEntry | null;
  onDashboard: () => void;
}) {
  if (!entry || entry.status === 'transcribing' || entry.status === 'uploaded') {
    return (
      <div className="center-col">
        <p className="tag">⏳ まだ分析中です</p>
        <p className="muted">
          少し時間がかかっています。分析が終わり次第、ダッシュボードで結果を確認できます。
        </p>
        <button className="primary-btn" onClick={onDashboard}>
          ダッシュボードを見る
        </button>
      </div>
    );
  }

  if (entry.status === 'failed') {
    return (
      <div className="center-col">
        <p className="error-text">
          分析に失敗しました(自動リトライ済み)。動画自体は保存されているので、時間を置いて再度確認してください。
        </p>
        <button className="primary-btn" onClick={onDashboard}>
          ダッシュボードを見る
        </button>
      </div>
    );
  }

  const a = entry.analysis;
  return (
    <div className="center-col">
      <p className="tag">✅ 分析完了</p>
      <h2>今日の記録が保存されました</h2>
      {a && (
        <div className="stat-row">
          <StatTile value={`${a.durationSec}秒`} label="英語で話せた時間" variant="duration" />
          <StatTile value={a.wordsPerMinute} label="発話速度(words/分)" variant="alt" />
          <StatTile value={a.wordCount} label="今日の発話語数" />
          <StatTile value={a.newWordCount} label="新出語彙数" />
          <StatTile value={a.cumulativeUniqueWordCount} label="累積ユニーク語彙数" />
          <StatTile
            value={a.typeTokenRatio === null ? '−' : `${Math.round(a.typeTokenRatio * 100)}%`}
            label="語彙多様度(TTR)"
            variant="alt"
          />
        </div>
      )}
      <p className="muted">日本語の回答も動画として保存済みです(参考記録・分析対象外)</p>
      <button className="primary-btn" onClick={onDashboard}>
        ダッシュボードを見る
      </button>
    </div>
  );
}

function StatTile({
  value,
  label,
  variant,
}: {
  value: string | number;
  label: string;
  variant?: 'duration' | 'alt';
}) {
  return (
    <div className={`stat-tile ${variant ?? ''}`}>
      <div className="num">{value}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}
