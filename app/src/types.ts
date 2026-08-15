export interface Child {
  childId: string;
  name: string;
  birthdate: string;
  /** 顔写真の署名付きURL。未設定の場合はnull(プレースホルダー表示。要件定義書5.5章) */
  photoUrl: string | null;
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
}

export interface HistoryEntry {
  date: string;
  questionText: string;
  status: RecordingStatus;
  videoUrlJa: string | null;
  videoUrlEn: string | null;
  durationSecJa: number | null;
  durationSecEn: number | null;
  analysis: AnalysisResult | null;
}

export interface HistoryResponse {
  childId: string;
  history: HistoryEntry[];
}
