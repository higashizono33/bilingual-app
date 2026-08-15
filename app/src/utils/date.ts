import { config } from '../config';

/**
 * アプリの「今日」の日付文字列(YYYY-MM-DD)を、要件定義書9章で決定済みの
 * 米国中部時間(Central Time)基準で返す。日本滞在中もこの基準で統一する。
 */
export function todayDateString(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.appTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA ロケールは YYYY-MM-DD 形式を返す
  return formatter.format(new Date());
}

export function formatDurationSec(durationSec: number | null | undefined): string {
  if (durationSec === null || durationSec === undefined) return '-';
  return `${durationSec}秒`;
}
