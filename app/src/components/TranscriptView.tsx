import { lemmatize } from '@bilingual-app/analysis';

interface TranscriptViewProps {
  /**
   * 子供の発話の文字起こし(話者分離が有効な場合、親の声を除いた子供の発話のみ)。
   * `get-history`/録画直後の分析結果から取得した`transcriptEn`をそのまま渡す
   */
  transcript: string;
  /** このセッションで新出語彙としてカウントされたレンマ一覧(`AnalysisResult.newLemmas`) */
  newLemmas: string[];
}

/**
 * 子供が実際に話した文章を、新出語彙としてカウントされた単語だけハイライトして表示する
 * (要件定義書外・実機フィードバックにより追加。「何が採点に繋がったか」を保護者が一目で
 * 確認できるようにする)。表示は原文の大文字小文字・語順をそのまま保ち、判定だけ
 * `lemmatize()`(analysisパッケージと同じロジック)で行う。
 */
export function TranscriptView({ transcript, newLemmas }: TranscriptViewProps) {
  if (!transcript) {
    return <p className="muted">文字起こしがありません</p>;
  }

  const newLemmaSet = new Set(newLemmas);
  // アルファベット+アポストロフィの並びを「単語」、それ以外(空白・句読点)をそのまま区切り文字として保持する
  const parts = transcript.split(/([a-zA-Z']+)/);

  return (
    <p className="transcript-text">
      {parts.map((part, i) =>
        /^[a-zA-Z']+$/.test(part) && newLemmaSet.has(lemmatize(part)) ? (
          <mark key={i} className="transcript-highlight">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}
