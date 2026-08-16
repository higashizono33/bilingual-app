import { useEffect, useRef } from 'react';
import { useRecorder, type RecorderResult } from '../hooks/useRecorder';
import type { BackgroundEffect } from '../utils/backgroundProcessor';

interface RecordStepProps {
  lang: 'ja' | 'en';
  question: string;
  onUse: (result: RecorderResult) => void;
  /** 背景処理(RecordScreen側で選択された内容をそのまま渡す。ja/en両ステップで共通) */
  backgroundEffect: BackgroundEffect;
  backgroundColor: string;
}

/**
 * 「今日は何をした?」への1言語分の録画UI(要件定義書5.1章)。
 * 専用アプリ内カメラ(`getUserMedia`)で撮影し、その場でプレビュー→採用/撮り直しができる。
 * 親が子供を撮影する用途のため背面カメラを優先し、必要に応じて背景をぼかす/単色化する
 * (実機フィードバックにより追加。`useRecorder`/`backgroundProcessor.ts`参照)。
 */
export function RecordStep({ lang, question, onUse, backgroundEffect, backgroundColor }: RecordStepProps) {
  const { status, error, elapsedSec, result, stream, start, stop, reset } = useRecorder({
    backgroundEffect,
    backgroundColor,
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div className={`question-box ${lang}`}>
      <span className={`tag ${lang}`}>{lang === 'en' ? '🇺🇸 English' : '🇯🇵 日本語'}</span>
      <div className="q-text">{question}</div>
      {lang === 'en' && <p className="muted">数秒だけでもOK。話せた時間も記録します。</p>}

      <div className="rec-area">
        {status === 'idle' && (
          <div className="center-col">
            <button className="primary-btn" onClick={start}>
              🎥 録画開始
            </button>
          </div>
        )}

        {status === 'error' && (
          <p className="error-text">
            カメラ/マイクにアクセスできませんでした: {error?.message}
          </p>
        )}

        {status === 'recording' && (
          <div className="center-col">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} autoPlay muted playsInline />
            <p className="muted">
              <span className="rec-dot" />
              録画中… {elapsedSec}秒
            </p>
            <button className="primary-btn danger-btn" onClick={stop}>
              ■ 録画停止
            </button>
          </div>
        )}

        {status === 'preview' && result && (
          <div className="center-col">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={result.previewUrl} controls playsInline />
            <p className="muted">録画時間: 約{result.durationSec}秒</p>
            <div className="rec-controls">
              <button className="ghost-btn" onClick={reset}>
                🔁 撮り直す
              </button>
              <button className="primary-btn" onClick={() => onUse(result)}>
                この動画を使う
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
