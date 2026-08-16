import { useCallback, useEffect, useRef, useState } from 'react';
import { createBackgroundProcessor, type BackgroundEffect, type BackgroundProcessorHandle } from '../utils/backgroundProcessor';

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

export interface UseRecorderOptions {
  /** 背景処理('off'ならそのまま、'blur'/'color'なら人物以外を加工する)。デフォルト'off' */
  backgroundEffect?: BackgroundEffect;
  /** backgroundEffect: 'color' のときの塗りつぶし色 */
  backgroundColor?: string;
}

/**
 * `getUserMedia` によるアプリ内カメラ録画(要件定義書5.1章)。
 * 撮影→アップロードを1つの流れに統合するため、専用アプリ内カメラのみをサポートする
 * (端末の標準カメラアプリからの手動アップロードは行わない)。
 *
 * 親が子供を撮る用途のため、背面カメラ(environment)を優先して起動する(`facingMode: { ideal: 'environment' }`。
 * `ideal`指定なので背面カメラの無い端末=PCの内蔵カメラなどでは自動的に利用可能なカメラにフォールバックする)。
 */
export function useRecorder(options: UseRecorderOptions = {}) {
  const { backgroundEffect = 'off', backgroundColor } = options;

  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [result, setResult] = useState<RecorderResult | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  /** 背景処理の初期化に失敗し、素のカメラ映像にフォールバックした場合の注意文言(録画自体は継続) */
  const [backgroundWarning, setBackgroundWarning] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  /** カメラから取得した生ストリーム。背景処理ON時もカメラ自体の停止(ライト消灯)にはこちらを使う */
  const rawStreamRef = useRef<MediaStream | null>(null);
  /** 背景処理(セグメンテーション)のrAFループ等を保持するハンドル。背景処理OFF時はnull */
  const processorRef = useRef<BackgroundProcessorHandle | null>(null);
  /** MediaRecorder/プレビューに渡している実ストリーム(生 or 背景処理後) */
  const activeStreamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    processorRef.current?.stop();
    processorRef.current = null;
    activeStreamRef.current?.getTracks().forEach((t) => t.stop());
    activeStreamRef.current = null;
    rawStreamRef.current?.getTracks().forEach((t) => t.stop());
    rawStreamRef.current = null;
  }, []);

  // アンマウント時(録画途中で画面遷移した場合など)にカメラ・GPUリソースを確実に解放する
  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    setBackgroundWarning(null);
    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: true,
      });
      rawStreamRef.current = rawStream;

      let mediaStream = rawStream;
      if (backgroundEffect !== 'off') {
        try {
          const processor = await createBackgroundProcessor(rawStream, {
            effect: backgroundEffect,
            color: backgroundColor,
          });
          processorRef.current = processor;
          mediaStream = processor.stream;
        } catch (bgErr) {
          // 背景処理が使えない端末(WebGL/WASM非対応等)では素のカメラ映像にフォールバックして録画は継続する
          console.warn('背景処理を初期化できなかったため、通常の映像で録画します', bgErr);
          setBackgroundWarning('背景処理(ぼかし/単色)を初期化できなかったため、通常の映像で録画しています');
        }
      }
      activeStreamRef.current = mediaStream;

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
        cleanup();
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
      cleanup();
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus('error');
    }
  }, [backgroundEffect, backgroundColor, cleanup]);

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

  return { status, error, elapsedSec, result, stream, backgroundWarning, start, stop, reset };
}
