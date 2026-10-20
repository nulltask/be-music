import { describe, expect, it } from 'vite-plus/test';
import { LR2_BAR_BODY_KINDS, LR2_BAR_LAMP_KINDS } from '../ids/bar.ts';
import {
  clampColorByte,
  parseBarBodyKind,
  parseBarGraphMuki,
  parseBarLampKind,
  parseBarLevelKind,
  parseBarRankKind,
  parseBarRivalKind,
  parseDestination,
  parseNowComboAlignment,
  parseNumberAlignment,
  parseSliderMuki,
  parseTextAlignment,
  toNumber,
} from './fields.ts';

describe('toNumber', () => {
  it('parses a numeric column and falls back on a blank or non-numeric one', () => {
    expect(toNumber('12.5', 0)).toBe(12.5);
    expect(toNumber(' -3', 0)).toBe(-3);
    expect(toNumber(undefined, 7)).toBe(7);
    expect(toNumber('', 7)).toBe(7);
    expect(toNumber('abc', 7)).toBe(7);
  });
});

describe('clampColorByte', () => {
  it('truncates into 0..255 and maps a non-finite value to 0', () => {
    expect(clampColorByte(12.9)).toBe(12);
    expect(clampColorByte(300)).toBe(255);
    expect(clampColorByte(-5)).toBe(0);
    expect(clampColorByte(Number.NaN)).toBe(0);
  });
});

describe('parseDestination', () => {
  // #DST_*,(NULL),time,x,y,w,h,acc,a,r,g,b,blend,filter,angle,center,loop,timer,op1,op2,op3,op4
  const row = (...columns: string[]): string[] => ['#DST_IMAGE', '0', ...columns];

  it('reads every keyframe column', () => {
    expect(
      parseDestination(
        row(
          '100',
          '1',
          '2',
          '30',
          '40',
          '2',
          '51',
          '10',
          '20',
          '30',
          '2',
          '1',
          '90',
          '5',
          '-1',
          '3',
          '161',
          '-55',
          '0',
          '1',
        ),
      ),
    ).toEqual({
      time: 100,
      x: 1,
      y: 2,
      w: 30,
      h: 40,
      acc: 2,
      alpha: 51 / 255,
      r: 10,
      g: 20,
      b: 30,
      blend: 2,
      filter: 1,
      angle: 90,
      center: 5,
      loop: -1,
      timer: 3,
      ops: [161, -55],
      op4: 1,
    });
  });

  it('defaults blank columns and marks a blank timer for inheritance', () => {
    expect(parseDestination(row('0', '0', '0', '10', '10'))).toMatchObject({
      acc: 0,
      alpha: 1,
      r: 255,
      g: 255,
      b: 255,
      timer: -1,
      ops: [],
      op4: 0,
    });
  });

  it('clamps the time, the easing and the alpha', () => {
    expect(parseDestination(row('-5', '0', '0', '1', '1', '9', '999'))).toMatchObject({ time: 0, acc: 3, alpha: 1 });
  });
});

describe('alignment and direction columns', () => {
  it('reads NUMBER and NOWCOMBO alignment as 0 = right, 1 = left, 2 = center', () => {
    for (const parse of [parseNumberAlignment, parseNowComboAlignment]) {
      expect([parse('0'), parse('1'), parse('2'), parse(undefined)]).toEqual(['right', 'left', 'center', 'right']);
    }
  });

  it('reads TEXT alignment as 0 = left, 1 = center, 2 = right', () => {
    expect([parseTextAlignment('0'), parseTextAlignment('1'), parseTextAlignment('2')]).toEqual([
      'left',
      'center',
      'right',
    ]);
  });

  it('reads BARGRAPH and SLIDER muki', () => {
    expect([parseBarGraphMuki('0'), parseBarGraphMuki('1')]).toEqual(['horizontal', 'vertical']);
    expect([parseSliderMuki('0'), parseSliderMuki('1'), parseSliderMuki('2'), parseSliderMuki('3')]).toEqual([
      'right',
      'left',
      'down',
      'up',
    ]);
  });
});

describe('bar kind columns', () => {
  it('maps every bar body and bar lamp index to its kind', () => {
    LR2_BAR_BODY_KINDS.forEach((kind, index) => expect(parseBarBodyKind(String(index))).toBe(kind));
    LR2_BAR_LAMP_KINDS.forEach((kind, index) => expect(parseBarLampKind(String(index))).toBe(kind));
  });

  it('maps bar level, rank and rival indices to their kinds', () => {
    expect([parseBarLevelKind('0'), parseBarLevelKind('3'), parseBarLevelKind('6')]).toEqual([
      'undefined',
      'hyper',
      'irRanking',
    ]);
    expect([parseBarRankKind('0'), parseBarRankKind('1'), parseBarRankKind('8')]).toEqual(['noplay', 'F', 'AAA']);
    expect([parseBarRivalKind('0'), parseBarRivalKind('1'), parseBarRivalKind('2')]).toEqual(['win', 'lose', 'draw']);
  });

  it('rejects indices outside each table', () => {
    for (const parse of [parseBarBodyKind, parseBarLampKind, parseBarLevelKind, parseBarRankKind, parseBarRivalKind]) {
      expect(parse('99')).toBeUndefined();
      expect(parse(undefined)).toBeUndefined();
    }
  });
});
