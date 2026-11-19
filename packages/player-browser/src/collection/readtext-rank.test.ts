import { describe, expect, it } from 'vite-plus/test';
import { rankReadtexts, readtextScore } from './readtext-rank.ts';

const names = (files: readonly { name: string }[]) => files.map((file) => file.name);
const file = (name: string, text = 'notes') => ({ name, text });

describe('readtextScore', () => {
  it('scores a plain readme above a BGA, difference-chart or numbered one', () => {
    for (const other of [
      'readmeBGA.txt',
      'readme_bga.txt',
      'readme2.txt',
      'readme-b.txt',
      'read me 2nd.txt',
      'sabun.txt',
    ]) {
      expect(readtextScore(file('readme.txt'))).toBeGreaterThan(readtextScore(file(other)));
    }
  });

  it('takes numbering and symbols around readme as a plain readme', () => {
    const plain = readtextScore(file('readme.txt'));
    for (const name of ['_readme.txt', '@readme.txt', '001_readme.txt', 'README.TXT', 'Read Me!!.txt', 're@dme.txt']) {
      expect(readtextScore(file(name))).toBe(plain);
    }
  });

  it('scores a score-attack entry, lyrics and a chart saved as text below any note', () => {
    const note = readtextScore(file('memo.txt'));
    expect(readtextScore(file('entry.txt', '[Start of Score] : 申請する時は'))).toBeLessThan(note);
    expect(readtextScore(file('002_lyric.txt'))).toBeLessThan(note);
    expect(readtextScore(file('_bms.txt', '*---------------------- HEADER FIELD\n#PLAYER 1\n#00111:01'))).toBeLessThan(
      note,
    );
  });

  it('scores chart metadata up and a difference-chart note down', () => {
    expect(readtextScore(file('a.txt', 'GENRE: TRANCE\nTITLE: Jade Star'))).toBeGreaterThan(
      readtextScore(file('a.txt')),
    );
    expect(readtextScore(file('a.txt', 'これは差分データです。'))).toBeLessThan(readtextScore(file('a.txt')));
  });
});

describe('rankReadtexts', () => {
  it('puts the likeliest README first', () => {
    expect(names(rankReadtexts([file('score.txt'), file('readmeBGA.txt'), file('readme.txt')]))).toEqual([
      'readme.txt',
      'readmeBGA.txt',
      'score.txt',
    ]);
  });

  it('prefers the original chart’s note over a difference chart’s, even both named readme', () => {
    const files = [
      file('readme.txt', '「snow memories」の、bme差分です。'),
      file('read me.txt', 'snow memories / ken\nlevel 2\ngenre: trance'),
    ];
    expect(rankReadtexts(files)[0]?.name).toBe('read me.txt');
  });

  it('keeps the order of files that score the same', () => {
    expect(names(rankReadtexts([file('b.txt'), file('a.txt')]))).toEqual(['b.txt', 'a.txt']);
    expect(rankReadtexts([])).toEqual([]);
  });
});
