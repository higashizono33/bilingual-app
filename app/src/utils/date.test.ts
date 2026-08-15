import { describe, expect, it } from 'vitest';
import { formatDurationSec, todayDateString } from './date';

describe('todayDateString', () => {
  it('YYYY-MM-DD形式の文字列を返す(要件定義書9章: 米国中部時間基準)', () => {
    expect(todayDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('formatDurationSec', () => {
  it('秒数を「n秒」表記にする', () => {
    expect(formatDurationSec(12)).toBe('12秒');
    expect(formatDurationSec(0)).toBe('0秒');
  });

  it('null/undefinedは-を返す', () => {
    expect(formatDurationSec(null)).toBe('-');
    expect(formatDurationSec(undefined)).toBe('-');
  });
});
