import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { getHistory, listChildren } from '../api/client';
import { LineChart } from '../components/LineChart';
import type { Child, HistoryEntry } from '../types';

/**
 * 子供ごとの英語の伸びダッシュボード(要件定義書5.4章)。
 * 英語で話せた時間の推移を最上部に表示(最重要指標)。
 */
export function DashboardScreen() {
  const { childId } = useParams<{ childId: string }>();
  const { idToken } = useAuth();
  const navigate = useNavigate();

  const [children, setChildren] = useState<Child[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!idToken || !childId) return;
    setHistory(null);
    Promise.all([listChildren(idToken), getHistory(idToken, childId)])
      .then(([childrenRes, historyRes]) => {
        setChildren(childrenRes.children);
        setHistory(historyRes.history.filter((h) => h.analysis !== null));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [idToken, childId]);

  if (!childId) return null;
  const child = children?.find((c) => c.childId === childId);
  const rows = (history ?? []).map((h) => {
    const { date: _analysisDate, ...analysisRest } = h.analysis!;
    void _analysisDate;
    return { date: h.date, ...analysisRest };
  });
  const latest = rows[rows.length - 1];

  return (
    <main className="page">
      <button className="back-link" onClick={() => navigate('/')}>
        ← ホームに戻る
      </button>

      <div className="card">
        <p className="tag">{child?.name ?? childId} の英語の伸び</p>

        {error && <p className="error-text">{error}</p>}
        {!history && !error && <p className="muted">読み込み中…</p>}

        {history && rows.length === 0 && (
          <p className="muted">まだ分析済みの記録がありません。今日の記録をはじめましょう。</p>
        )}

        {rows.length > 0 && (
          <>
            <div className="stat-row">
              <StatTile value={`${latest.durationSec}秒`} label="直近の英語発話時間" variant="duration" />
              <StatTile value={latest.wordsPerMinute} label="直近の発話速度(words/分)" variant="alt" />
              <StatTile value={latest.cumulativeUniqueWordCount} label="累積ユニーク語彙数" />
              <StatTile value={rows.length} label="記録日数" />
            </div>

            <div className="chart-title">🗣️ 英語で話せた時間の推移(秒)</div>
            <LineChart data={rows} field="durationSec" color="#c77d1a" unit="秒" />

            <div className="chart-title">🏃 発話速度の推移(words per minute)</div>
            <LineChart data={rows} field="wordsPerMinute" color="#7a5ea8" />

            <div className="chart-title">📚 累積ユニーク語彙数の推移</div>
            <LineChart
              data={rows}
              field="cumulativeUniqueWordCount"
              color="#3f6fb4"
              dotColor={(r) => (r.newWordCount > 0 ? '#2f8f5b' : '#3f6fb4')}
            />

            <div className="chart-title">🎨 語彙多様度の推移(Type-Token Ratio, %)</div>
            <LineChart
              data={rows.map((r) => ({ ...r, ttrPercent: r.typeTokenRatio ? Math.round(r.typeTokenRatio * 100) : 0 }))}
              field="ttrPercent"
              color="#2f8f5b"
              unit="%"
            />

            <div className="chart-title">⏸️ 間(ポーズ)の合計時間の推移(秒・下がるほどスムーズ)</div>
            <LineChart data={rows} field="totalPauseSec" color="#52606d" unit="秒" />

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>発話時間</th>
                    <th>速度</th>
                    <th>TTR</th>
                    <th>発話語数</th>
                    <th>新出語彙</th>
                    <th>累積語彙</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .slice()
                    .reverse()
                    .map((r) => (
                      <tr key={r.date}>
                        <td>{r.date}</td>
                        <td>{r.durationSec}秒</td>
                        <td>{r.wordsPerMinute}</td>
                        <td>{r.typeTokenRatio === null ? '−' : `${Math.round(r.typeTokenRatio * 100)}%`}</td>
                        <td>{r.wordCount}</td>
                        <td>+{r.newWordCount}</td>
                        <td>{r.cumulativeUniqueWordCount}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="note">
              📌 発話速度・語彙多様度(TTR)・間(ポーズ)は、いずれもAmazon Transcribeの標準出力だけで追加コストなしに算出しています。累積ユニーク語彙数はレンマ(word
              family)ベースでカウントしています。日本語の回答動画はここでは数値化せず、参考記録として別途視聴できます。
            </div>
          </>
        )}
      </div>

      <div className="grid2">
        {children?.map((c) => (
          <div key={c.childId} className="tile secondary" onClick={() => navigate(`/dashboard/${c.childId}`)}>
            {c.name}を見る
          </div>
        ))}
      </div>
    </main>
  );
}

function StatTile({ value, label, variant }: { value: string | number; label: string; variant?: 'duration' | 'alt' }) {
  return (
    <div className={`stat-tile ${variant ?? ''}`}>
      <div className="num">{value}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}
