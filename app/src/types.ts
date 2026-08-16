export interface Child {
  childId: string;
  name: string;
  birthdate: string;
  /** 顔写真の署名付きURL。未設定の場合はnull(プレースホルダー表示。要件定義書5.5章) */
  photoUrl: string | null;
  /** ホーム画面での表示順(小さいほど先=左に表示)。APIが常に一貫した値を計算して返す */
  sortOrder: number;
}

export type RecordingStatus = 'uploaded' | 'transcribing' | 'analyzed' | 'failed';

export interface AnalysisResult {
  recordingId: string;
  childId: string;
  date: string;
  /** 英語で話せた時間(秒)。要件定義書6章の最重要指標 */
  durationSec: number;
  wordCount: number;
  uniqueWordCount: number;
  newWordCount: number;
  cumulativeUniqueWordCount: number;
  wordsPerMinute: number;
  typeTokenRatio: number | null;
  sentenceCount: number;
  avgSentenceLength: number | null;
  pauseCount: number;
  totalPauseSec: number;
  /** このセッションで初めて登場したレンマ一覧(newWordCountの内訳)。transcriptEn上でのハイライト表示用 */
  newLemmas: string[];
}

export interface HistoryEntry {
  date: string;
  questionText: string;
  status: RecordingStatus;
  videoUrlJa: string | null;
  videoUrlEn: string | null;
  durationSecJa: number | null;
  durationSecEn: number | null;
  /**
   * 英語動画の文字起こし(話者分離が有効な場合、親の声を除いた子供の発話のみ)。
   * 未分析またはTranscribeがまだ完了していない場合はnull
   */
  transcriptEn: string | null;
  analysis: AnalysisResult | null;
}

export interface HistoryResponse {
  childId: string;
  history: HistoryEntry[];
}
