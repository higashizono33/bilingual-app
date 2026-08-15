import { lemmatize, tokenize } from './lemmatize.js';

/**
 * Amazon Transcribe の標準出力(JSON)のうち、本アプリで使う部分の最小限の型定義。
 * https://docs.aws.amazon.com/transcribe/latest/dg/how-input.html
 */
export interface TranscribeItem {
  type: 'pronunciation' | 'punctuation';
  alternatives: { content: string; confidence?: string }[];
  start_time?: string;
  end_time?: string;
}

export interface TranscribeResult {
  results: {
    transcripts: { transcript: string }[];
    items: TranscribeItem[];
  };
}

export interface SessionWordMetrics {
  /** 総発話語数(表層形ベース) */
  wordCount: number;
  /** ユニーク語彙数(レンマ/word familyベース。そのセッション内) */
  uniqueWordCount: number;
  /** 新出語彙数(これまでに一度も出てきていないレンマの数) */
  newWordCount: number;
  /** 累積ユニーク語彙数(記録開始から今回までの合計) */
  cumulativeUniqueWordCount: number;
  /** このセッションで使われたレンマ一覧(次回の累積語彙集合の更新に使う) */
  sessionLemmas: string[];
  /** 発話速度(words per minute) */
  wordsPerMinute: number;
  /** 語彙多様度(Type-Token Ratio)。発話がない場合はnull */
  typeTokenRatio: number | null;
}

/**
 * 発話語数・ユニーク語彙数・新出語彙数・WPM・TTRを算出する(要件定義書6章)。
 * 無音・極端に短い発話(tokens=[])でもエラーにならず、0/nullを返す。
 */
export function computeSessionWordMetrics(params: {
  tokens: string[];
  durationSec: number;
  priorLemmas: ReadonlySet<string>;
}): SessionWordMetrics {
  const { tokens, durationSec, priorLemmas } = params;
  const wordCount = tokens.length;
  const lemmaSet = new Set(tokens.map(lemmatize));
  const uniqueWordCount = lemmaSet.size;

  let newWordCount = 0;
  for (const lemma of lemmaSet) {
    if (!priorLemmas.has(lemma)) newWordCount++;
  }
  const cumulativeUniqueWordCount = priorLemmas.size + newWordCount;

  const wordsPerMinute = durationSec > 0 ? Math.round((wordCount / durationSec) * 60) : 0;
  const typeTokenRatio = wordCount > 0 ? Number((uniqueWordCount / wordCount).toFixed(2)) : null;

  return {
    wordCount,
    uniqueWordCount,
    newWordCount,
    cumulativeUniqueWordCount,
    sessionLemmas: Array.from(lemmaSet),
    wordsPerMinute,
    typeTokenRatio,
  };
}

export interface PauseMetrics {
  /** thresholdSec以上の間(ポーズ)の回数 */
  pauseCount: number;
  /** 間(ポーズ)の合計時間(秒) */
  totalPauseSec: number;
}

/**
 * Transcribeが返す単語ごとのStartTime/EndTimeから、単語間の間(ポーズ)を算出する
 * (要件定義書6章「間(ポーズ)のanalysis」)。追加コストなしでTranscribeの標準出力のみで計算できる。
 */
export function computePauseMetrics(
  items: TranscribeItem[],
  thresholdSec = 1.0,
): PauseMetrics {
  let pauseCount = 0;
  let totalPauseSec = 0;
  let prevEnd: number | null = null;

  for (const item of items) {
    // punctuation(句読点)アイテムはstart_time/end_timeを持たないためスキップ
    if (item.type !== 'pronunciation') continue;
    const start = item.start_time !== undefined ? Number.parseFloat(item.start_time) : NaN;
    const end = item.end_time !== undefined ? Number.parseFloat(item.end_time) : NaN;
    if (Number.isNaN(start) || Number.isNaN(end)) continue;

    if (prevEnd !== null) {
      const gap = start - prevEnd;
      if (gap >= thresholdSec) {
        pauseCount++;
        totalPauseSec += gap;
      }
    }
    prevEnd = end;
  }

  return { pauseCount, totalPauseSec: Number(totalPauseSec.toFixed(1)) };
}

export interface SentenceMetrics {
  sentenceCount: number;
  /** 平均文長(語数/文)。文が無い場合はnull */
  avgSentenceLength: number | null;
}

/**
 * Transcribeの自動句読点機能で区切られた文単位から、文の複雑さの目安を算出する(要件定義書6章)。
 */
export function computeSentenceMetrics(transcript: string, wordCount: number): SentenceMetrics {
  const sentences = transcript
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const sentenceCount = sentences.length;
  const avgSentenceLength = sentenceCount > 0 ? Number((wordCount / sentenceCount).toFixed(1)) : null;
  return { sentenceCount, avgSentenceLength };
}

export interface AnalysisInput {
  /** Amazon Transcribe ジョブの標準出力(JSON) */
  transcribeResult: TranscribeResult;
  /** 録画時間(秒)。DailyRecording.durationSecEnより */
  durationSec: number;
  /** これまでの累積語彙(レンマ)集合 */
  priorLemmas: ReadonlySet<string>;
  /** ポーズ判定の閾値(秒)。デフォルト1.0秒 */
  pauseThresholdSec?: number;
}

/**
 * AnalysisResult(要件定義書7章のデータモデル)のうち、Transcribe結果から算出可能な項目。
 * durationSec(英語で話せた時間)自体はTranscribe不要でLambda側の録画メタデータから
 * そのまま転記する想定のため、呼び出し側でAnalysisInput.durationSecをそのまま保存してよい。
 */
export interface AnalysisResult extends SessionWordMetrics, PauseMetrics, SentenceMetrics {
  durationSec: number;
}

/**
 * Transcribeの1ジョブ分の結果から、ダッシュボード表示用のAnalysisResultをまとめて算出する。
 * 無音・極端に短い発話でも例外を投げず、0件相当の結果を返す(要件定義書6章末尾の注記)。
 */
export function analyzeTranscribeResult(input: AnalysisInput): AnalysisResult {
  const { transcribeResult, durationSec, priorLemmas, pauseThresholdSec } = input;
  const transcript = transcribeResult.results?.transcripts?.[0]?.transcript ?? '';
  const items = transcribeResult.results?.items ?? [];

  const tokens = tokenize(transcript);
  const wordMetrics = computeSessionWordMetrics({ tokens, durationSec, priorLemmas });
  const pauseMetrics = computePauseMetrics(items, pauseThresholdSec);
  const sentenceMetrics = computeSentenceMetrics(transcript, wordMetrics.wordCount);

  return {
    durationSec,
    ...wordMetrics,
    ...pauseMetrics,
    ...sentenceMetrics,
  };
}
