import { describe, expect, it } from 'vitest';
import { lemmatize, tokenize } from '../src/lemmatize.js';

describe('lemmatize', () => {
  it('go/goes/going/went/gone を同一レンマにまとめる(要件定義書6章の例)', () => {
    expect(lemmatize('go')).toBe('go');
    expect(lemmatize('goes')).toBe('go');
    expect(lemmatize('going')).toBe('go');
    expect(lemmatize('went')).toBe('go');
    expect(lemmatize('gone')).toBe('go');
  });

  it('be動詞の活用をまとめる', () => {
    expect(lemmatize('is')).toBe('be');
    expect(lemmatize('am')).toBe('be');
    expect(lemmatize('are')).toBe('be');
    expect(lemmatize('was')).toBe('be');
    expect(lemmatize('were')).toBe('be');
  });

  it('サイレントe動詞の活用をまとめる(規則接尾辞除去だけでは復元できないケース)', () => {
    expect(lemmatize('like')).toBe('like');
    expect(lemmatize('liked')).toBe('like');
    expect(lemmatize('liking')).toBe('like');
    expect(lemmatize('loved')).toBe('love');
  });

  it('二重子音の規則活用を正しく戻す(running/stopped)', () => {
    expect(lemmatize('running')).toBe('run');
    expect(lemmatize('stopped')).toBe('stop');
    expect(lemmatize('swimming')).toBe('swim');
  });

  it('通常の規則活用(-s/-ing/-ed)を処理する', () => {
    expect(lemmatize('plays')).toBe('play');
    expect(lemmatize('playing')).toBe('play');
    expect(lemmatize('played')).toBe('play');
    expect(lemmatize('jumps')).toBe('jump');
    expect(lemmatize('watched')).toBe('watch');
    expect(lemmatize('watches')).toBe('watch');
  });

  it('-ies/-ied を -y に戻す', () => {
    expect(lemmatize('studies')).toBe('study');
    expect(lemmatize('studied')).toBe('study');
  });

  it('不規則名詞の複数形をまとめる', () => {
    expect(lemmatize('children')).toBe('child');
    expect(lemmatize('feet')).toBe('foot');
  });

  it('大文字小文字を区別しない', () => {
    expect(lemmatize('Went')).toBe('go');
  });

  it('該当しない語はそのまま返す', () => {
    expect(lemmatize('park')).toBe('park');
    expect(lemmatize('happy')).toBe('happy');
  });
});

describe('tokenize', () => {
  it('句読点を除去し小文字化して分割する', () => {
    expect(tokenize('I went to the park. It was fun!')).toEqual([
      'i', 'went', 'to', 'the', 'park', 'it', 'was', 'fun',
    ]);
  });

  it('空文字列(無音)はエラーにならず空配列を返す', () => {
    expect(tokenize('')).toEqual([]);
  });
});
