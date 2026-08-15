import { describe, expect, it } from 'vitest';
import {
  analyzeTranscribeResult,
  computePauseMetrics,
  computeSentenceMetrics,
  computeSessionWordMetrics,
  type TranscribeResult,
} from '../src/metrics.js';

describe('computeSessionWordMetrics', () => {
  it('go/goes/going を1レンマとしてユニーク語彙数を数える', () => {
    const result = computeSessionWordMetrics({
      tokens: ['i', 'go', 'to', 'the', 'park', 'and', 'goes', 'home'],
      durationSec: 8,
      priorLemmas: new Set<string>(),
    });
    // "go" と "goes" は同一レンマなので、ユニーク語彙数は表層形の語数より少なくなる
    expect(result.wordCount).toBe(8);
    expect(result.uniqueWordCount).toBeLessThan(result.wordCount);
    expect(result.uniqueWordCount).toBe(new Set(['i', 'go', 'to', 'the', 'park', 'and', 'home']).size);
  });

  it('新出語彙数は累積語彙集合に無いレンマのみをカウントする', () => {
    const priorLemmas = new Set(['i', 'go', 'park']);
    const result = computeSessionWordMetrics({
      tokens: ['i', 'go', 'home'],
      durationSec: 3,
      priorLemmas,
    });
    // "home" のみ新出
    expect(result.newWordCount).toBe(1);
    expect(result.cumulativeUniqueWordCount).toBe(priorLemmas.size + 1);
  });

  it('無音(空トークン)でもエラーにならず0を返す', () => {
    const result = computeSessionWordMetrics({ tokens: [], durationSec: 0, priorLemmas: new Set() });
    expect(result.wordCount).toBe(0);
    expect(result.uniqueWordCount).toBe(0);
    expect(result.newWordCount).toBe(0);
    expect(result.wordsPerMinute).toBe(0);
    expect(result.typeTokenRatio).toBeNull();
  });

  it('WPMは語数÷発話時間(秒)×60で算出する', () => {
    const result = computeSessionWordMetrics({
      tokens: Array(10).fill('word'),
      durationSec: 20,
      priorLemmas: new Set(),
    });
    expect(result.wordsPerMinute).toBe(30); // 10語 / 20秒 * 60 = 30 wpm
  });
});

describe('computePauseMetrics', () => {
  it('閾値(デフォルト1秒)以上の間だけをポーズとしてカウントする', () => {
    const items = [
      { type: 'pronunciation' as const, alternatives: [{ content: 'I' }], start_time: '0.0', end_time: '0.3' },
      // 0.3 -> 0.5: 0.2秒の間はポーズ扱いしない
      { type: 'pronunciation' as const, alternatives: [{ content: 'went' }], start_time: '0.5', end_time: '1.0' },
      // 1.0 -> 3.0: 2秒の間はポーズ
      { type: 'pronunciation' as const, alternatives: [{ content: 'home' }], start_time: '3.0', end_time: '3.5' },
    ];
    const result = computePauseMetrics(items);
    expect(result.pauseCount).toBe(1);
    expect(result.totalPauseSec).toBe(2.0);
  });

  it('punctuationアイテム(start_time/end_timeが無い)は無視する', () => {
    const items = [
      { type: 'pronunciation' as const, alternatives: [{ content: 'Hi' }], start_time: '0.0', end_time: '0.2' },
      { type: 'punctuation' as const, alternatives: [{ content: '.' }] },
      { type: 'pronunciation' as const, alternatives: [{ content: 'there' }], start_time: '0.3', end_time: '0.6' },
    ];
    expect(() => computePauseMetrics(items)).not.toThrow();
    expect(computePauseMetrics(items).pauseCount).toBe(0);
  });

  it('itemsが空でもエラーにならない', () => {
    expect(computePauseMetrics([])).toEqual({ pauseCount: 0, totalPauseSec: 0 });
  });
});

describe('computeSentenceMetrics', () => {
  it('文末の句読点で文を区切り平均文長を算出する', () => {
    const result = computeSentenceMetrics('I went to the park. I saw a dog.', 8);
    expect(result.sentenceCount).toBe(2);
    expect(result.avgSentenceLength).toBe(4);
  });

  it('空文字列でもエラーにならない', () => {
    const result = computeSentenceMetrics('', 0);
    expect(result.sentenceCount).toBe(0);
    expect(result.avgSentenceLength).toBeNull();
  });
});

describe('analyzeTranscribeResult', () => {
  const sampleTranscribeResult: TranscribeResult = {
    results: {
      transcripts: [{ transcript: 'I went to the park. I saw a dog.' }],
      items: [
        { type: 'pronunciation', alternatives: [{ content: 'I' }], start_time: '0.0', end_time: '0.2' },
        { type: 'pronunciation', alternatives: [{ content: 'went' }], start_time: '0.3', end_time: '0.6' },
        { type: 'pronunciation', alternatives: [{ content: 'to' }], start_time: '0.7', end_time: '0.8' },
        { type: 'pronunciation', alternatives: [{ content: 'the' }], start_time: '0.9', end_time: '1.0' },
        { type: 'pronunciation', alternatives: [{ content: 'park' }], start_time: '1.1', end_time: '1.5' },
        { type: 'punctuation', alternatives: [{ content: '.' }] },
        // 1.5 -> 3.5: 2秒のポーズ(次の文へのつなぎ)
        { type: 'pronunciation', alternatives: [{ content: 'I' }], start_time: '3.5', end_time: '3.6' },
        { type: 'pronunciation', alternatives: [{ content: 'saw' }], start_time: '3.7', end_time: '3.9' },
        { type: 'pronunciation', alternatives: [{ content: 'a' }], start_time: '4.0', end_time: '4.1' },
        { type: 'pronunciation', alternatives: [{ content: 'dog' }], start_time: '4.2', end_time: '4.5' },
        { type: 'punctuation', alternatives: [{ content: '.' }] },
      ],
    },
  };

  it('Transcribe結果一式からAnalysisResultをまとめて算出する', () => {
    const result = analyzeTranscribeResult({
      transcribeResult: sampleTranscribeResult,
      durationSec: 5,
      priorLemmas: new Set(),
    });
    expect(result.durationSec).toBe(5);
    expect(result.wordCount).toBe(9); // "I went to the park. I saw a dog." = 9語(Iが2回)
    expect(result.sentenceCount).toBe(2);
    expect(result.pauseCount).toBe(1);
    expect(result.totalPauseSec).toBe(2.0);
    expect(result.wordsPerMinute).toBe(108); // 9語 / 5秒 * 60 = 108
    expect(result.typeTokenRatio).not.toBeNull();
  });

  it('無音の動画(空transcript)でも例外を投げず0件を返す(要件定義書6章末尾の注記)', () => {
    const emptyResult: TranscribeResult = {
      results: { transcripts: [{ transcript: '' }], items: [] },
    };
    expect(() =>
      analyzeTranscribeResult({ transcribeResult: emptyResult, durationSec: 0, priorLemmas: new Set() }),
    ).not.toThrow();
    const result = analyzeTranscribeResult({
      transcribeResult: emptyResult,
      durationSec: 0,
      priorLemmas: new Set(['go']),
    });
    expect(result.wordCount).toBe(0);
    expect(result.cumulativeUniqueWordCount).toBe(1); // priorLemmasのまま
  });
});
