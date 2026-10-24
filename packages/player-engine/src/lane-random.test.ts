import { describe, expect, test } from 'vite-plus/test';
import { randomizeSpiralNotes, randomizeSRandomNotes, type SRandomNote } from './lane-random.ts';
import { resolveLaneOptionChannels } from './core/lane-layout.ts';

const zero = () => 0;
function random(seed: number): () => number {
  let state = seed;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x1_0000_0000;
}

describe('randomizeSRandomNotes', () => {
  test.each(['lr2', 'beatoraja', '____'] as const)(
    '%s reserves long-note destinations through the tail row',
    (ruleset) => {
      const notes: SRandomNote[] = [
        { channel: '11', timeMs: 0, endTimeMs: 1000 },
        { channel: '12', timeMs: 0 },
        { channel: '12', timeMs: 300 },
        { channel: '12', timeMs: 1000 },
        { channel: '12', timeMs: 1000.001 },
      ];
      const original = structuredClone(notes);
      const channels = randomizeSRandomNotes(notes, ['11', '12'], { ruleset, random: zero });
      expect(channels).toEqual(['11', '12', '12', '12', '11']);
      expect(notes).toEqual(original);
    },
  );

  test.each([20, 40, 40.999, 41])('beatoraja uses a strict 40-integer-ms threshold (%s ms)', (timeMs) => {
    const notes = [
      { channel: '11', timeMs: 0 },
      { channel: '11', timeMs },
    ];
    expect(randomizeSRandomNotes(notes, ['11', '12'], { ruleset: 'lr2', random: zero })).toEqual(['11', '11']);
    expect(randomizeSRandomNotes(notes, ['11', '12'], { ruleset: 'beatoraja', random: zero })).toEqual([
      '11',
      timeMs >= 41 ? '11' : '12',
    ]);
  });

  test('beatoraja falls back to the oldest free lanes, with random tie-breaking', () => {
    const notes = [
      { channel: '11', timeMs: 0 },
      { channel: '12', timeMs: 0 },
      { channel: '11', timeMs: 10 },
      { channel: '11', timeMs: 20 },
      { channel: '11', timeMs: 30 },
    ];
    expect(randomizeSRandomNotes(notes, ['11', '12'], { ruleset: 'beatoraja', random: zero })).toEqual([
      '11',
      '12',
      '11',
      '12',
      '11',
    ]);
  });

  test('mines and invisible notes follow their row map without updating jack times', () => {
    const notes: SRandomNote[] = [
      { channel: '11', timeMs: 0, kind: 'mine' },
      { channel: '11', timeMs: 0, kind: 'invisible' },
      { channel: '11', timeMs: 10 },
    ];
    expect(randomizeSRandomNotes(notes, ['11', '12'], { ruleset: 'beatoraja', random: zero })).toEqual([
      '11',
      '11',
      '11',
    ]);
    const held: SRandomNote[] = [
      { channel: '11', timeMs: 0, endTimeMs: 1000 },
      { channel: '11', timeMs: 10, kind: 'mine' },
      { channel: '12', timeMs: 10, kind: 'invisible' },
      { channel: '13', timeMs: 10 },
    ];
    expect(randomizeSRandomNotes(held, ['11', '12', '13'], { ruleset: 'beatoraja', random: zero })).toEqual([
      '11',
      '11',
      '13',
      '12',
    ]);
  });

  test.each(['5', '7', '9', '10', '14', '24', '48'] as const)(
    'preserves chords, LN occupancy and boundaries in %s-key mode',
    (variant) => {
      for (const side of ['1P', '2P'] as const) {
        const lanes = resolveLaneOptionChannels(side, variant);
        if (lanes.length < 2) continue;
        const notes: SRandomNote[] = [
          { channel: lanes[0]!, timeMs: 0, endTimeMs: 1000 },
          ...[0, 10, 40, 200, 1000].flatMap((timeMs) => lanes.slice(1).map((channel) => ({ channel, timeMs }))),
          { channel: side === '1P' ? '21' : '11', timeMs: 50 },
          {
            channel:
              variant === '24' || variant === '48' || variant === '9'
                ? side === '1P'
                  ? '1P'
                  : '2P'
                : side === '1P'
                  ? '16'
                  : '26',
            timeMs: 50,
          },
        ];
        for (const ruleset of ['lr2', 'beatoraja'] as const) {
          for (let seed = 1; seed <= 20; seed += 1) {
            const channels = randomizeSRandomNotes(notes, lanes, { ruleset, random: random(seed) });
            expect(channels).toEqual(randomizeSRandomNotes(notes, lanes, { ruleset, random: random(seed) }));
            for (const timeMs of [0, 10, 40, 200, 1000]) {
              const row = channels.filter((_, index) => notes[index]!.timeMs === timeMs);
              expect(new Set(row).size).toBe(row.length);
              expect(row.every((channel) => lanes.includes(channel))).toBe(true);
              if (timeMs > 0) expect(row).not.toContain(channels[0]);
            }
            expect(channels.slice(-2)).toEqual(notes.slice(-2).map((note) => note.channel));
          }
        }
      }
    },
  );

  test('LR2 also keeps mines out of held destinations, while beatoraja preserves their active source map', () => {
    const notes: SRandomNote[] = [
      { channel: '11', timeMs: 0, endTimeMs: 1000 },
      { channel: '11', timeMs: 10, kind: 'mine' },
    ];
    expect(randomizeSRandomNotes(notes, ['11', '12'], { ruleset: 'lr2', random: zero })).toEqual(['11', '12']);
    expect(randomizeSRandomNotes(notes, ['11', '12'], { ruleset: 'beatoraja', random: zero })).toEqual(['11', '11']);
  });

  test('an impossible LR2 row fails instead of retrying forever', () => {
    expect(() =>
      randomizeSRandomNotes(
        [
          { channel: '11', timeMs: 0, endTimeMs: 1000 },
          { channel: '11', timeMs: 10 },
        ],
        ['11'],
        { ruleset: 'lr2', random: zero },
      ),
    ).toThrow(/available lanes/);
  });

  test('PMS-STD treats its encoded right-bank keys as part of the same domain', () => {
    const lanes = resolveLaneOptionChannels('1P', '9', [{ channel: '22' }]);
    const notes = [
      { channel: '11', timeMs: 0, endTimeMs: 100 },
      { channel: '22', timeMs: 10 },
    ];
    expect(randomizeSRandomNotes(notes, lanes, { ruleset: 'lr2', random: zero })).toEqual(['11', '12']);
    expect(
      randomizeSRandomNotes(notes, [], {
        ruleset: 'lr2',
        random: () => {
          throw new Error('unused');
        },
      }),
    ).toEqual(['11', '22']);
  });

  test('processes rows chronologically and keeps output aligned to unsorted input', () => {
    const notes = [
      { channel: '11', timeMs: 10 },
      { channel: '11', timeMs: 0 },
    ];
    expect(randomizeSRandomNotes(notes, ['11', '12'], { ruleset: 'beatoraja', random: zero })).toEqual(['12', '11']);
  });

  test.each([-1, 1, Number.NaN])('rejects an invalid random draw %s', (draw) => {
    expect(() =>
      randomizeSRandomNotes([{ channel: '11', timeMs: 0 }], ['11', '12'], { ruleset: 'lr2', random: () => draw }),
    ).toThrow(RangeError);
  });
});

describe('randomizeSpiralNotes', () => {
  test('advances once per occupied row, including scratch, other side, mines and hidden-only rows', () => {
    const notes: SRandomNote[] = [
      { channel: 'a', timeMs: 0 },
      { channel: 'b', timeMs: 0 },
      { channel: '16', timeMs: 1 },
      { channel: '21', timeMs: 2 },
      { channel: 'a', timeMs: 3, kind: 'mine' },
      { channel: 'a', timeMs: 4, kind: 'invisible' },
      { channel: 'a', timeMs: 5 },
    ];
    const original = structuredClone(notes);
    expect(randomizeSpiralNotes(notes, ['a', 'b', 'c'], zero)).toEqual(['b', 'c', '16', '21', 'b', 'c', 'a']);
    expect(notes).toEqual(original);
  });

  test('freezes until every overlapping LN ends, including exact tail-row chords', () => {
    const notes: SRandomNote[] = [
      { channel: 'a', timeMs: 0, endTimeMs: 20 },
      { channel: 'b', timeMs: 5, endTimeMs: 30 },
      { channel: 'c', timeMs: 20 },
      { channel: 'a', timeMs: 25 },
      { channel: 'a', timeMs: 30 },
      { channel: 'a', timeMs: 31 },
    ];
    expect(randomizeSpiralNotes(notes, ['a', 'b', 'c'], zero)).toEqual(['b', 'c', 'a', 'b', 'b', 'c']);
  });

  test('visits an outside-domain LN tail even when no head occurs on that row', () => {
    expect(
      randomizeSpiralNotes(
        [
          { channel: '16', timeMs: 0, endTimeMs: 1 },
          { channel: 'a', timeMs: 2 },
        ],
        ['a', 'b', 'c'],
        zero,
      ),
    ).toEqual(['16', 'a']);
  });

  test('chooses each nonzero increment once and sorts rows without reordering output', () => {
    const notes = [
      { channel: 'a', timeMs: 2 },
      { channel: 'a', timeMs: 0 },
      { channel: 'a', timeMs: 1 },
    ];
    expect(randomizeSpiralNotes(notes, ['a', 'b', 'c', 'd'], () => 0.5)).toEqual(['c', 'c', 'a']);
    expect(randomizeSpiralNotes(notes, ['a', 'b', 'c', 'd'], () => 0.99)).toEqual(['b', 'd', 'c']);
  });

  test('handles empty or single-lane domains without drawing, and rejects invalid randomness', () => {
    const notes = [{ channel: 'a', timeMs: 0 }];
    const fail = () => {
      throw new Error('draw');
    };
    expect(randomizeSpiralNotes(notes, [], fail)).toEqual(['a']);
    expect(randomizeSpiralNotes(notes, ['a'], fail)).toEqual(['a']);
    expect(() => randomizeSpiralNotes(notes, ['a', 'b'], () => 1)).toThrow(RangeError);
  });
});
