import { lemmatize, tokenize } from './lemmatize.js';

/**
 * Amazon Transcribe の標準出力(JSON)のうち、本アプリで使う部分の最小限の型定義。
 * https://docs.aws.amazon.com/transcribe/latest/dg/how-input.html
 *
 * `speaker_label`はTranscriptionJobの`Settings.ShowSpeakerLabels: true`指定時のみ含まれる
 * (話者分離。親の声が動画に混入した場合に子供の発話だけを抽出するために使う。下記参照)。
 */
export interface TranscribeItem {
  type: 'pronunciation' | 'punctuation';
  alternatives: { content: string; confidence?: string }[];
  start_time?: string;
  end_time?: string;
  speaker_label?: string;
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
  /** このセッションで初めて登場したレンマ一覧(newWordCountの内訳。文字起こし上でのハイライト表示用) */
  newLemmas: string[];
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
  const newLemmas: string[] = [];
  for (const lemma of lemmaSet) {
    if (!priorLemmas.has(lemma)) {
      newWordCount++;
      newLemmas.push(lemma);
    }
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
    newLemmas,
    wordsPerMinute,
    typeTokenRatio,
  };
}

/**
 * 話者分離(`speaker_label`)が有効な場合に、最も発話時間が長い話者を「子供」とみなして返す
 * (要件定義書外・実機フィードバックにより追加。録画時に親の声が混入しても、親が短く質問して
 * 子供が長く答える、という前提のもと発話時間の多い方を子供と判定する簡易ヒューリスティック)。
 * `speaker_label`が1つも無い場合(話者分離が無効、または単一話者)はundefinedを返し、
 * 呼び出し側はフィルタせず全文をそのまま使う。
 */
export function pickPrimarySpeaker(items: TranscribeItem[]): string | undefined {
  const durationBySpeaker = new Map<string, number>();

  for (const item of items) {
    if (item.type !== 'pronunciation' || !item.speaker_label) continue;
    const start = item.start_time !== undefined ? Number.parseFloat(item.start_time) : NaN;
    const end = item.end_time !== undefined ? Number.parseFloat(item.end_time) : NaN;
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    durationBySpeaker.set(item.speaker_label, (durationBySpeaker.get(item.speaker_label) ?? 0) + (end - start));
  }

  if (durationBySpeaker.size === 0) return undefined;

  let primarySpeaker: string | undefined;
  let maxDuration = -1;
  for (const [speaker, duration] of durationBySpeaker) {
    if (duration > maxDuration) {
      maxDuration = duration;
      primarySpeaker = speaker;
    }
  }
  return primarySpeaker;
}

/**
 * 信頼度がこの値未満のpronunciationアイテムは分析・文字起こし表示から除外する(デフォルト0.4)。
 *
 * Transcribeジョブは`LanguageCode: 'en-US'`固定のため、子供が録画中に誤って日本語を話しても
 * 「日本語だから除外する」という判定はできず、英語モデルが無理やり英語っぽい単語に変換してしまう
 * (実機フィードバックにより発覚)。ただしその際のconfidence(信頼度)は通常著しく低くなる傾向があるため、
 * 低信頼度の単語を除外することで、日本語の誤変換が語彙カウントに混入するのを軽減する簡易ヒューリスティック。
 * 完全な言語判定ではない(小声・言い淀みなど本物の低信頼度英語も巻き込む可能性はある)。
 */
export const MIN_WORD_CONFIDENCE = 0.4;

/**
 * confidence情報が無いアイテムは対象から除外しない(後方互換。古いTranscribe出力やテストフィクスチャ向け)。
 */
function isConfidentPronunciation(item: TranscribeItem, threshold: number): boolean {
  if (item.type !== 'pronunciation') return true;
  const confidence = item.alternatives?.[0]?.confidence;
  if (confidence === undefined) return true;
  const value = Number.parseFloat(confidence);
  return Number.isNaN(value) || value >= threshold;
}

/**
 * 信頼度がthreshold未満のpronunciationアイテムを取り除く(`MIN_WORD_CONFIDENCE`参照)。
 * punctuationアイテムやconfidence情報が無いアイテムはそのまま残す。
 */
export function filterLowConfidenceItems(
  items: TranscribeItem[],
  threshold: number = MIN_WORD_CONFIDENCE,
): TranscribeItem[] {
  return items.filter((item) => isConfidentPronunciation(item, threshold));
}

/**
 * items配列から指定話者(未指定の場合は全話者)の発話だけをつなげて文字列に復元する。
 * type: 'punctuation'のアイテムは直前の単語に空白無しで連結する(Transcribeの標準的な復元方法)。
 */
export function reconstructTranscript(items: TranscribeItem[], speakerLabel?: string): string {
  let text = '';
  for (const item of items) {
    if (speakerLabel !== undefined && item.speaker_label !== speakerLabel) continue;
    const content = item.alternatives?.[0]?.content ?? '';
    if (!content) continue;
    if (item.type === 'punctuation' || text.length === 0) {
      text += content;
    } else {
      text += ` ${content}`;
    }
  }
  return text;
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
  /** 日本語混入対策の信頼度足切り閾値。デフォルト`MIN_WORD_CONFIDENCE`(0.4) */
  minWordConfidence?: number;
}

/**
 * AnalysisResult(要件定義書7章のデータモデル)のうち、Transcribe結果から算出可能な項目。
 * durationSec(英語で話せた時間)自体はTranscribe不要でLambda側の録画メタデータから
 * そのまま転記する想定のため、呼び出し側でAnalysisInput.durationSecをそのまま保存してよい。
 */
export interface AnalysisResult extends SessionWordMetrics, PauseMetrics, SentenceMetrics {
  durationSec: number;
  /**
   * 分析対象になった発話の文字起こし。話者分離(speaker_label)が有効な場合は最も発話時間が
   * 長い話者(=子供と推定)の発話だけに絞った文字列、話者分離が無効な場合は全文をそのまま使う。
   * ダッシュボードで「実際に何を話して、何がカウントされたか」を可視化するために保存・表示する。
   */
  transcript: string;
}

/**
 * Transcribeの1ジョブ分の結果から、ダッシュボード表示用のAnalysisResultをまとめて算出する。
 * 無音・極端に短い発話でも例外を投げず、0件相当の結果を返す(要件定義書6章末尾の注記)。
 *
 * 話者分離(`Settings.ShowSpeakerLabels`)が有効な場合、録画に親の声が混入していても
 * 発話時間の長い話者(子供と推定)だけに絞り込んでから語彙・ポーズ・文の指標を算出する
 * (実機フィードバックにより追加。`pickPrimarySpeaker`/`reconstructTranscript`参照)。
 * さらに、信頼度が低い単語(誤って混入した日本語をenモデルが無理やり英語に変換したもの等)も
 * `MIN_WORD_CONFIDENCE`未満なら除外する(`filterLowConfidenceItems`参照)。
 */
export function analyzeTranscribeResult(input: AnalysisInput): AnalysisResult {
  const { transcribeResult, durationSec, priorLemmas, pauseThresholdSec, minWordConfidence } = input;
  const items = transcribeResult.results?.items ?? [];
  const primarySpeaker = pickPrimarySpeaker(items);

  const speakerFiltered = primarySpeaker !== undefined ? items.filter((i) => i.speaker_label === primarySpeaker) : items;
  const relevantItems = filterLowConfidenceItems(speakerFiltered, minWordConfidence);

  // 話者分離・信頼度フィルタのどちらも何も除外していない場合は、Transcribeが返す全文transcriptを
  // そのまま使う(復元ロジック(reconstructTranscript)による句読点の間隔等の微妙な差異を避けるための
  // 後方互換パス。過去の分析結果や、話者分離情報が無い単一話者の録画で有効)
  const transcript =
    primarySpeaker !== undefined || relevantItems.length !== items.length
      ? reconstructTranscript(relevantItems)
      : (transcribeResult.results?.transcripts?.[0]?.transcript ?? '');

  const tokens = tokenize(transcript);
  const wordMetrics = computeSessionWordMetrics({ tokens, durationSec, priorLemmas });
  const pauseMetrics = computePauseMetrics(relevantItems, pauseThresholdSec);
  const sentenceMetrics = computeSentenceMetrics(transcript, wordMetrics.wordCount);

  return {
    durationSec,
    transcript,
    ...wordMetrics,
    ...pauseMetrics,
    ...sentenceMetrics,
  };
}
