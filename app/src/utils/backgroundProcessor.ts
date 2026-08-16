import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

/**
 * 録画中の背景処理(要件外だったが、実機確認時のフィードバックにより追加)。
 * 'off': 何もしない(通常のカメラ映像) / 'blur': 背景をぼかす / 'color': 背景を単色で塗りつぶす。
 */
export type BackgroundEffect = 'off' | 'blur' | 'color';

export interface BackgroundProcessorOptions {
  effect: 'blur' | 'color';
  /** effect: 'color' のときの塗りつぶし色(CSSカラー文字列) */
  color?: string;
  /** effect: 'blur' のときのぼかし強度(px) */
  blurPx?: number;
}

export interface BackgroundProcessorHandle {
  /** 背景処理後の映像トラック + 元ストリームの音声トラックを合成したストリーム */
  stream: MediaStream;
  /** rAFループの停止・内部リソース(隠しvideo/canvas)の解放。ストリーム自体のトラック停止は呼び出し側の責務 */
  stop: () => void;
}

// MediaPipeのWASMランタイム本体とセグメンテーションモデルはCDNから取得する(要件定義書の
// コスト最小構成の対象外。ビルド成果物へのWASM同梱はVite設定が煩雑になるため見送り、
// Google公式CDN配信のものをそのまま利用する)
const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

let segmenterPromise: Promise<ImageSegmenter> | null = null;

/** ImageSegmenterの初期化(WASM+モデルのダウンロード)は重いのでアプリ内で使い回す(モジュールスコープでキャッシュ) */
function getSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = FilesetResolver.forVisionTasks(WASM_BASE_URL).then(async (fileset) => {
      try {
        return await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      } catch {
        // GPU delegate非対応の端末向けにCPUへフォールバック
        return ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          runningMode: 'VIDEO',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      }
    });
  }
  return segmenterPromise;
}

/**
 * カメラの生映像から人物だけを切り抜き、背景をぼかす/単色にした合成映像ストリームを作る。
 * 実装方針: 隠しvideo要素で生映像を受け、フレームごとにImageSegmenterで人物のconfidence
 * maskを取得 → マスクをアルファチャンネルとして人物だけを切り抜いたcanvas + 背景(ぼかし/単色)の
 * canvasを合成 → その出力canvasを`captureStream()`し、元ストリームの音声トラックと結合する。
 */
export async function createBackgroundProcessor(
  rawStream: MediaStream,
  options: BackgroundProcessorOptions,
): Promise<BackgroundProcessorHandle> {
  const segmenter = await getSegmenter();

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream(rawStream.getVideoTracks());
  await video.play();
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => {
      video.onloadeddata = () => resolve();
    });
  }

  const width = video.videoWidth;
  const height = video.videoHeight;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d');

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d');

  const personCanvas = document.createElement('canvas');
  personCanvas.width = width;
  personCanvas.height = height;
  const personCtx = personCanvas.getContext('2d');

  if (!outCtx || !maskCtx || !personCtx) {
    throw new Error('Canvas 2D contextの取得に失敗しました');
  }

  let rafId = 0;
  let stopped = false;

  function renderFrame() {
    if (stopped) return;
    const timestampMs = performance.now();
    segmenter.segmentForVideo(video, timestampMs, (result) => {
      const confidenceMask = result.confidenceMasks?.[0];
      if (!confidenceMask || stopped) {
        confidenceMask?.close();
        if (!stopped) rafId = requestAnimationFrame(renderFrame);
        return;
      }

      const maskData = confidenceMask.getAsFloat32Array();
      const maskImageData = maskCtx!.createImageData(width, height);
      for (let i = 0; i < maskData.length; i++) {
        maskImageData.data[i * 4 + 3] = Math.round(maskData[i] * 255);
      }
      maskCtx!.putImageData(maskImageData, 0, 0);
      confidenceMask.close();

      // 人物部分だけを切り抜く(マスクの値をアルファとして使い destination-in で合成)
      personCtx!.clearRect(0, 0, width, height);
      personCtx!.drawImage(video, 0, 0, width, height);
      personCtx!.globalCompositeOperation = 'destination-in';
      personCtx!.drawImage(maskCanvas, 0, 0);
      personCtx!.globalCompositeOperation = 'source-over';

      // 背景(ぼかし or 単色)を描いてから、その上に人物を重ねる
      outCtx!.save();
      if (options.effect === 'blur') {
        outCtx!.filter = `blur(${options.blurPx ?? 16}px)`;
        outCtx!.drawImage(video, 0, 0, width, height);
        outCtx!.filter = 'none';
      } else {
        outCtx!.fillStyle = options.color ?? '#e8f0fb';
        outCtx!.fillRect(0, 0, width, height);
      }
      outCtx!.restore();
      outCtx!.drawImage(personCanvas, 0, 0);

      if (!stopped) rafId = requestAnimationFrame(renderFrame);
    });
  }

  renderFrame();

  const canvasStream = outCanvas.captureStream(30);
  const audioTracks = rawStream.getAudioTracks();
  const outputStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);

  return {
    stream: outputStream,
    stop: () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      video.pause();
      video.srcObject = null;
      canvasStream.getTracks().forEach((t) => t.stop());
    },
  };
}
