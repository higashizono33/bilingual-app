import { useCallback, useRef, useState } from 'react';

export type RecorderStatus = 'idle' | 'recording' | 'preview' | 'error';

/**
 * 動画候補MIMEタイプ。要件定義書5.1章: iPad/iPhone(WebKit)では常にMP4(H.264+AAC)を出力するため
 * 最優先で試す。Mac/Windows/Android等のChromium系ブラウザで録画した場合はwebmへフォールバックする
 * (5.2章: 無理にmp4へ変換せずwebmのまま保存する方針)。
 */
const MIME_CANDIDATES = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export interface RecorderResult {
  blob: Blob;
  mimeType: string;
  durationSec: number;
  previewUrl: string;
}

/**
 * `getUserMedia` によるアプリ内カメラ録画(要件定義書5.1章)。
 * 撮影→アップロードを1つの流れに統合するため、専用アプリ内カメラのみをサポートする
 * (端末の標準カメラアプリからの手動アップロードは行わない)。
 */
export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [result, setResult] = useState<RecorderResult | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  const stopStream = useCallback((s: MediaStream | null) => {
    s?.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const mimeType = pickSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'video/webm' });
        const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        setResult({ blob, mimeType: blob.type, durationSec, previewUrl: URL.createObjectURL(blob) });
        setStatus('preview');
        stopStream(mediaStream);
        setStream(null);
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setStream(mediaStream);
      setStatus('recording');
      setElapsedSec(0);
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.round((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus('error');
    }
  }, [stopStream]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  const reset = useCallback(() => {
    if (result?.previewUrl) URL.revokeObjectURL(result.previewUrl);
    setResult(null);
    setElapsedSec(0);
    setStatus('idle');
  }, [result]);

  return { status, error, elapsedSec, result, stream, start, stop, reset };
}
