import { resolveChart, type ChartPlayVariant } from '@be-music/chart-model';
import { parseChart } from '@be-music/chart-parser';
import { preparePlaybackChart } from '@be-music/player-engine';
import { createReplayRecorder } from '@be-music/player-engine/replay';
import { createEmptyScore } from '@be-music/player-engine/ruleset';
import { applyReplayArrangement } from '../../chart/replay-arrangement.ts';

import { describe, expect, test } from 'vite-plus/test';
import { resolveLaneOptionChannels } from '@be-music/player-engine/lanes';
import {
  applyBattleRandomMode,
  pairTwoPlayerTwins,
  applyRandomMode,
  extractChartExtension,
  flipDPChannel,
  shuffleArray,
} from './play-chart.ts';

/** A seeded random (mulberry32), so every draw is the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface TestNote {
  channel: string;
  beat: number;
}

function notesOn(channels: readonly string[], beat = 0): TestNote[] {
  return channels.map((channel) => ({ channel, beat }));
}

function channelsOf(notes: readonly { channel: string }[]): string[] {
  return notes.map((note) => note.channel);
}

/** The 1P keys of a 7 KEY chart, as the lane options permute them: the scratch (16) stays out. */
const KEYS_1P = resolveLaneOptionChannels('1P', '7');
const KEYS_7 = ['11', '12', '13', '14', '15', '18', '19'];

describe('applyRandomMode', () => {
  test('the 1P lane options move the seven keys of a 7 KEY chart', () => {
    expect(KEYS_1P).toEqual(KEYS_7);
  });

  test('OFF leaves every note on its lane', () => {
    const notes = notesOn([...KEYS_7, '16']);
    applyRandomMode(notes, KEYS_1P, 'OFF', seededRandom(1));
    expect(channelsOf(notes)).toEqual([...KEYS_7, '16']);
  });

  test('sparse seven-key MIRROR uses the complete mode, including empty lanes', () => {
    const notes = notesOn(['12', '13', '14', '15', '18', '19']);
    applyRandomMode(notes, KEYS_1P, 'MIRROR', seededRandom(1));
    expect(channelsOf(notes)).toEqual(['18', '15', '14', '13', '12', '11']);
  });

  test('a single used key can move under RANDOM within the complete mode', () => {
    const notes = notesOn(['13']);
    const expected = shuffleArray([...KEYS_7], seededRandom(1))[KEYS_7.indexOf('13')];
    applyRandomMode(notes, KEYS_1P, 'RANDOM', seededRandom(1));
    expect(channelsOf(notes)).toEqual([expected]);
  });

  test('MIRROR reverses the keys and leaves the scratch', () => {
    const notes = notesOn([...KEYS_7, '16']);
    applyRandomMode(notes, KEYS_1P, 'MIRROR', seededRandom(1));
    expect(channelsOf(notes)).toEqual(['19', '18', '15', '14', '13', '12', '11', '16']);
  });

  test('MIRROR stays within the five-key mode domain', () => {
    const notes = notesOn(['11', '12', '13', '14', '15']);
    applyRandomMode(notes, resolveLaneOptionChannels('1P', '5'), 'MIRROR', seededRandom(1));
    expect(channelsOf(notes)).toEqual(['15', '14', '13', '12', '11']);
  });

  test('mines and invisible notes follow the playable notes to their new lanes', () => {
    const notes = notesOn(['11', '12', '13']);
    const mines = notesOn(['11']);
    const invisible = notesOn(['13', '14']);
    applyRandomMode(notes, KEYS_1P, 'MIRROR', seededRandom(1), {}, mines, invisible);
    expect(channelsOf(mines)).toEqual(['19']);
    // Unused lanes take part in the same full-mode permutation.
    expect(channelsOf(invisible)).toEqual(['15', '14']);
  });

  test('RANDOM moves every key by one permutation drawn from the random', () => {
    const notes = [...notesOn(KEYS_7, 0), ...notesOn(KEYS_7, 1), ...notesOn(['16'], 2)];
    applyRandomMode(notes, KEYS_1P, 'RANDOM', seededRandom(7));
    const expected = shuffleArray([...KEYS_7], seededRandom(7));
    expect(channelsOf(notes)).toEqual([...expected, ...expected, '16']);
    expect([...expected].sort()).toEqual(KEYS_7);
    expect(expected).not.toEqual(KEYS_7);
  });

  test('SCATTER, an LR2 arrangement, arranges the notes under beatoraja rules too', () => {
    const notes = [{ channel: '11', beat: 0, endBeat: 2 }, ...notesOn(KEYS_7.slice(1), 1)];
    let draws = 0;
    expect(() =>
      applyRandomMode(
        notes,
        KEYS_1P,
        'SCATTER',
        () => {
          draws += 1;
          return 0.5;
        },
        { ruleset: 'beatoraja' },
      ),
    ).not.toThrow();
    // LR2's SCATTER runs under beatoraja rules too (#774): it draws, and keeps every note on a key lane.
    expect(draws).toBeGreaterThan(0);
    expect(notes.every((note) => KEYS_1P.includes(note.channel))).toBe(true);
  });

  test('S-RANDOM selects the active judge ruleset instead of the drawing family', () => {
    const lr2 = [
      { channel: '11', seconds: 0 },
      { channel: '11', seconds: 0.02 },
    ];
    const beatoraja = structuredClone(lr2);
    applyRandomMode(lr2, KEYS_1P, 'S-RANDOM', () => 0, { ruleset: 'lr2' });
    applyRandomMode(beatoraja, KEYS_1P, 'S-RANDOM', () => 0, { ruleset: 'beatoraja' });
    expect(channelsOf(lr2)).toEqual(['11', '11']);
    expect(channelsOf(beatoraja)).toEqual(['11', '12']);
  });

  test('S-RANDOM never places a later tap inside a held LN', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const long = { channel: '11', beat: 0, seconds: 0, endBeat: 4, endSeconds: 2 };
      const taps = [1, 2, 3].map((beat) => ({ channel: '12', beat, seconds: beat / 2 }));
      applyRandomMode([long, ...taps], KEYS_1P, 'S-RANDOM', seededRandom(seed));
      expect(taps.every((note) => note.channel !== long.channel)).toBe(true);
    }
  });

  test('S-RANDOM keeps simultaneous notes unique within the full mode', () => {
    const chords = [0, 1, 2, 3].map((beat) => notesOn(['11', '12', '13'], beat));
    const notes = chords.flat();
    applyRandomMode(notes, KEYS_1P, 'S-RANDOM', seededRandom(3));
    for (const chord of chords) {
      expect(new Set(channelsOf(chord)).size).toBe(3);
      expect(channelsOf(chord).every((channel) => KEYS_1P.includes(channel))).toBe(true);
    }
    expect(new Set(chords.map((chord) => channelsOf(chord).join())).size).toBeGreaterThan(1);
  });

  test('a 1P option leaves the 2P lanes alone', () => {
    const notes = notesOn(['11', '12', '21', '22', '26']);
    applyRandomMode(notes, KEYS_1P, 'MIRROR', seededRandom(1));
    expect(channelsOf(notes)).toEqual(['19', '18', '21', '22', '26']);
  });

  test('RANDOM remaps a sparse chart while preserving scratch', () => {
    const notes = notesOn(['13', '13', '16']);
    applyRandomMode(notes, KEYS_1P, 'RANDOM', seededRandom(1));
    expect(channelsOf(notes)).toEqual(['19', '19', '16']);
  });
});

describe('flipDPChannel (DP FLIP)', () => {
  test('swaps the 1P and 2P sides of a lane', () => {
    expect(['11', '16', '19', '21', '26', '29'].map(flipDPChannel)).toEqual(['21', '26', '29', '11', '16', '19']);
  });

  test('leaves channels of no side as they are', () => {
    expect(['01', '04', 'D1', '31', '1', ''].map(flipDPChannel)).toEqual(['01', '04', 'D1', '31', '1', '']);
  });

  test('flipping twice puts every lane back', () => {
    const channels = ['11', '15', '16', '22', '28', '01'];
    expect(channels.map(flipDPChannel).map(flipDPChannel)).toEqual(channels);
  });
});

describe('extractChartExtension', () => {
  test('returns the chart file extension, lowercased', () => {
    expect(extractChartExtension('Songs/A/main.PMS')).toBe('.pms');
    expect(extractChartExtension('Songs\\A\\main.bme')).toBe('.bme');
  });

  test('ignores dots in folder names and paths without an extension', () => {
    expect(extractChartExtension('Songs/Bok.fps/01')).toBeUndefined();
    expect(extractChartExtension('main.')).toBeUndefined();
    expect(extractChartExtension('')).toBeUndefined();
    expect(extractChartExtension(undefined)).toBeUndefined();
  });
});

describe('shuffleArray', () => {
  test('permutes in place, the same way for the same random', () => {
    const first = shuffleArray([1, 2, 3, 4, 5, 6], seededRandom(5));
    const second = shuffleArray([1, 2, 3, 4, 5, 6], seededRandom(5));
    expect(second).toEqual(first);
    expect([...first].sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('returns the array it was given', () => {
    const array = [1, 2, 3];
    expect(shuffleArray(array, seededRandom(1))).toBe(array);
  });
});

test.each([
  ['5', '1P', '11', '15'],
  ['7', '1P', '12', '18'],
  ['10', '2P', '21', '25'],
  ['14', '2P', '22', '28'],
  ['24', '1P', '11', '1O'],
  ['48', '2P', '21', '2O'],
] as const)('sparse %s/%s MIRROR keeps the LN head and tail on %s→%s', (variant, side, from, to) => {
  const note = { channel: from as string, beat: 2, endBeat: 6, seconds: 1, endSeconds: 3 };
  const notes = [note];
  applyRandomMode(notes, resolveLaneOptionChannels(side, variant), 'MIRROR', seededRandom(1));
  expect(note).toEqual({ channel: to, beat: 2, endBeat: 6, seconds: 1, endSeconds: 3 });
});

test.each([
  ['11', '19', '16', '14'],
  ['11', '25', '22', '14'],
] as const)('PMS MIRROR maps both halves as one nine-key keyboard (%s→%s)', (left, right, sixth, fourth) => {
  const notes = notesOn([left, sixth]);
  const domains = notesOn([left, sixth]);
  applyRandomMode(notes, resolveLaneOptionChannels('1P', '9', domains), 'MIRROR', seededRandom(1));
  applyRandomMode(notes, resolveLaneOptionChannels('2P', '9', domains), 'MIRROR', seededRandom(1));
  expect(channelsOf(notes)).toEqual([right, fourth]);
});

test.each(['5', '7', '9', '10', '14', '24', '48'] as const)(
  'RANDOM is deterministic and bijective over the whole %s-key mode',
  (variant) => {
    for (const side of ['1P', '2P'] as const) {
      const lanes = resolveLaneOptionChannels(side, variant);
      const first = notesOn(lanes),
        second = notesOn(lanes);
      applyRandomMode(first, lanes, 'RANDOM', seededRandom(42));
      applyRandomMode(second, lanes, 'RANDOM', seededRandom(42));
      expect(first).toEqual(second);
      expect(channelsOf(first).sort()).toEqual([...lanes].sort());
    }
  },
);

test('recorded arrangements preserve the resolved full-mode placement and old sparse placements', () => {
  const json = parseChart('#BPM 120\n#LNOBJ AA\n#00012:0001\n#00112:00AA', 'bms');
  const prepare = () => preparePlaybackChart(resolveChart(json, { playVariant: '7' as ChartPlayVariant }));
  const chart = prepare();
  applyRandomMode(chart.notes, resolveLaneOptionChannels('1P', '7'), 'MIRROR', seededRandom(1));
  const replay = createReplayRecorder({
    json,
    chart,
    play: { mode: 'auto', autoScratch: false, randomLane: { p1: 'MIRROR' } },
  }).finalize({ summary: { ...createEmptyScore(1), fast: 0, slow: 0 } });
  expect(replay.chart.notes).toMatchObject([{ channel: '18', timeUs: 1_000_000, endTimeUs: 3_000_000 }]);
  const target = prepare();
  expect(applyReplayArrangement(replay.chart.notes, target)).toEqual({ ok: true });
  expect(target.notes[0]!.channel).toBe('18');
  // Historical files already store the exact channels; do not re-roll their old subset MIRROR.
  const oldNotes = replay.chart.notes.map((note) => ({ ...note, channel: '12' }));
  const oldTarget = prepare();
  expect(applyReplayArrangement(oldNotes, oldTarget)).toEqual({ ok: true });
  expect(oldTarget.notes[0]!.channel).toBe('12');
});

test.each([5, 7, 9])('R-RANDOM has exactly 2(N-1) distinct rotations for %s keys', (count) => {
  const lanes = Array.from({ length: count }, (_, i) => `key${i}`);
  const layouts = new Set<string>();
  for (let direction = 0; direction < 2; direction += 1) {
    for (let start = 0; start < count - 1; start += 1) {
      const notes = notesOn([...lanes, '16', '26']);
      const mines = notesOn(lanes);
      const invisible = notesOn(lanes);
      const draws = [direction / 2, start / (count - 1)];
      applyRandomMode(notes, lanes, 'R-RANDOM', () => draws.shift()!, { ruleset: 'beatoraja' }, mines, invisible);
      const layout = channelsOf(notes).slice(0, count);
      expect([...layout].sort()).toEqual([...lanes].sort());
      expect(layout).not.toEqual(lanes);
      expect(layout).not.toEqual([...lanes].reverse());
      expect(channelsOf(mines)).toEqual(layout);
      expect(channelsOf(invisible)).toEqual(layout);
      expect(channelsOf(notes).slice(count)).toEqual(['16', '26']);
      layouts.add(layout.join(','));
    }
  }
  expect(layouts.size).toBe(2 * (count - 1));
});

test('R-RANDOM rotates the lanes under LR2 rules too', () => {
  const notes = notesOn(KEYS_7);
  applyRandomMode(notes, KEYS_7, 'R-RANDOM', () => 0, { ruleset: 'lr2' });
  // A rotation: every lane stays used once, and the order is neither the original nor its mirror.
  expect([...channelsOf(notes)].sort()).toEqual([...KEYS_7].sort());
  expect(channelsOf(notes)).not.toEqual(KEYS_7);
  expect(channelsOf(notes)).not.toEqual([...KEYS_7].reverse());
});

test('R-RANDOM keeps LN ends, both DP sides and recorded arrangements stable', () => {
  const json = parseChart('#BPM 120\n#PLAYER 3\n#LNOBJ AA\n#00012:0001\n#00112:00AA\n#00022:0001\n#00122:00AA', 'bms');
  const prepare = () => preparePlaybackChart(resolveChart(json, { playVariant: '14' }));
  const chart = prepare();
  for (const side of ['1P', '2P'] as const)
    applyRandomMode(
      chart.notes,
      resolveLaneOptionChannels(side, '14'),
      'R-RANDOM',
      seededRandom(side === '1P' ? 1 : 2),
      { ruleset: 'beatoraja' },
    );
  const replay = createReplayRecorder({
    json,
    chart,
    play: { mode: 'auto', autoScratch: false, randomLane: { p1: 'R-RANDOM', p2: 'R-RANDOM' } },
  }).finalize({ summary: { ...createEmptyScore(2), fast: 0, slow: 0 } });
  const target = prepare();
  expect(applyReplayArrangement(replay.chart.notes, target)).toEqual({ ok: true });
  expect(target.notes.map(({ channel, seconds, endSeconds }) => ({ channel, seconds, endSeconds }))).toEqual(
    chart.notes.map(({ channel, seconds, endSeconds }) => ({ channel, seconds, endSeconds })),
  );
  expect(chart.notes.every((note) => note.endSeconds !== undefined)).toBe(true);
  expect(chart.notes[0]!.channel).toMatch(/^1/);
  expect(chart.notes[1]!.channel).toMatch(/^2/);
});

test('SPIRAL applies one row permutation to notes, mines and hidden notes, leaving scratch fixed', () => {
  const notes = [
    { channel: '11', seconds: 0, endSeconds: 1 },
    { channel: '12', seconds: 0.5 },
    { channel: '12', seconds: 1 },
    { channel: '12', seconds: 2 },
    { channel: '16', seconds: 0 },
  ];
  const mines = [{ channel: '12', seconds: 0.5 }];
  const hidden = [{ channel: '13', seconds: 0.5 }];
  applyRandomMode(notes, ['11', '12', '13'], 'SPIRAL', () => 0, { ruleset: 'beatoraja' }, mines, hidden);
  expect(channelsOf(notes)).toEqual(['12', '13', '13', '11', '16']);
  expect(channelsOf(mines)).toEqual(['13']);
  expect(channelsOf(hidden)).toEqual(['11']);
  expect(notes[0]!.endSeconds).toBe(1);
  // beatoraja's SPIRAL runs the same way under the other rulesets (#774).
  const acNotes = [
    { channel: '11', seconds: 0 },
    { channel: '11', seconds: 1 },
  ];
  applyRandomMode(acNotes, ['11', '12', '13'], 'SPIRAL', () => 0, { ruleset: '____' });
  expect(channelsOf(acNotes)).toEqual(['12', '13']);
});

test('H-RANDOM applies its configured source threshold under every ruleset', () => {
  const prepare = () => [
    { channel: '11', seconds: 0 },
    { channel: '11', seconds: 0.1 },
  ];
  const slow = prepare(),
    fast = prepare();
  applyRandomMode(slow, ['11', '12'], 'H-RANDOM', () => 0, { ruleset: 'beatoraja', hRandomThresholdBPM: 120 });
  applyRandomMode(fast, ['11', '12'], 'H-RANDOM', () => 0, { ruleset: 'beatoraja', hRandomThresholdBPM: 300 });
  expect(channelsOf(slow)).toEqual(['11', '12']);
  expect(channelsOf(fast)).toEqual(['11', '11']);
  const ac = prepare();
  applyRandomMode(ac, ['11', '12'], 'H-RANDOM', () => 0, { ruleset: '____', hRandomThresholdBPM: 120 });
  expect(channelsOf(ac)).toEqual(channelsOf(slow));
});

test.each(['1P', '2P'] as const)('LR2 CONVERGE selects the %s scratch or explicit key', (side) => {
  const keys = resolveLaneOptionChannels(side, '14');
  const scratch = side === '1P' ? '16' : '26';
  const notes = [
    { channel: keys[0]!, seconds: 0, endSeconds: 1 },
    { channel: keys[1]!, seconds: 2 },
  ];
  applyRandomMode(notes, keys, 'CONVERGE', () => 0, { scratch, ruleset: 'lr2' });
  expect(channelsOf(notes)).toEqual([scratch, scratch]);
  const explicit = [{ channel: keys[0]!, seconds: 0 }];
  applyRandomMode(explicit, keys, 'CONVERGE', () => 0, { scratch, fixedLane: 4 });
  expect(channelsOf(explicit)).toEqual([keys[3]]);
});

test('LR2 PMS CONVERGE defaults to key 5 and a missing side is a no-op', () => {
  const keys = resolveLaneOptionChannels('1P', '9');
  const notes = [{ channel: keys[0]!, seconds: 0 }];
  applyRandomMode(notes, keys, 'CONVERGE', () => 0);
  expect(channelsOf(notes)).toEqual([keys[4]]);
  applyRandomMode(notes, [], 'CONVERGE', () => 0);
  expect(channelsOf(notes)).toEqual([keys[4]]);
});

test.each(['1P', '2P'] as const)('ALL-SCR includes the complete %s scratch domain', (side) => {
  const keys = resolveLaneOptionChannels(side, '14');
  const scratch = side === '1P' ? '16' : '26';
  const notes = [
    { channel: keys[0]!, seconds: 0 },
    { channel: keys[1]!, seconds: 1 },
  ];
  applyRandomMode(notes, keys, 'ALL-SCR', () => 0, {
    ruleset: 'beatoraja',
    scratchLanes: [scratch],
    doublePlay: true,
    side,
  });
  expect(channelsOf(notes)).toEqual([scratch, scratch]);
});

test.each(['1P', '2P'] as const)('RANDOM-EX permutes the complete %s key/scratch domain consistently', (side) => {
  const keys = resolveLaneOptionChannels(side, '14');
  const scratch = side === '1P' ? '16' : '26';
  const domain = [...keys, scratch];
  const notes = notesOn(domain);
  const mines = notesOn(domain);
  const hidden = notesOn(domain);
  applyRandomMode(
    notes,
    keys,
    'RANDOM-EX',
    () => 0.99,
    { ruleset: 'beatoraja', scratchLanes: [scratch] },
    mines,
    hidden,
  );
  expect(channelsOf(notes)).toEqual([...domain].reverse());
  expect(channelsOf(mines)).toEqual(channelsOf(notes));
  expect(channelsOf(hidden)).toEqual(channelsOf(notes));
  expect(notes.at(-1)!.channel).not.toBe(scratch);
});

test('RANDOM-EX includes both wheel directions and preserves LN timing', () => {
  const keys = resolveLaneOptionChannels('1P', '24');
  const notes = [
    { channel: keys[0]!, seconds: 0, endSeconds: 2 },
    { channel: '1P', seconds: 3 },
    { channel: '1Q', seconds: 4 },
  ];
  applyRandomMode(notes, keys, 'RANDOM-EX', () => 0.99, { ruleset: 'beatoraja', scratchLanes: ['1P', '1Q'] });
  expect(channelsOf(notes)).toEqual(['1Q', keys[1], keys[0]]);
  expect(notes[0]!.endSeconds).toBe(2);
  // Under LR2 rules RANDOM-EX still runs beatoraja's scratch-inclusive shuffle, with the same draws.
  const lr2Notes = [
    { channel: keys[0]!, seconds: 0, endSeconds: 2 },
    { channel: '1P', seconds: 3 },
    { channel: '1Q', seconds: 4 },
  ];
  applyRandomMode(lr2Notes, keys, 'RANDOM-EX', () => 0.99, { ruleset: 'lr2', scratchLanes: ['1P', '1Q'] });
  expect(channelsOf(lr2Notes)).toEqual(channelsOf(notes));
  expect(() => applyRandomMode([], keys, 'RANDOM-EX', () => 0.99, { ruleset: 'beatoraja' })).toThrow(
    /requires scratch/,
  );
});

test('RANDOM-EX records the effective LN placement for replay without re-rolling', () => {
  const json = parseChart('#BPM 120\n#LNOBJ AA\n#00012:0001\n#00112:00AA', 'bms');
  const prepare = () => preparePlaybackChart(resolveChart(json, { playVariant: '7' }));
  const chart = prepare();
  applyRandomMode(chart.notes, KEYS_1P, 'RANDOM-EX', () => 0.99, { ruleset: 'beatoraja', scratchLanes: ['16'] });
  const replay = createReplayRecorder({
    json,
    chart,
    play: { mode: 'auto', autoScratch: false, randomLane: { p1: 'RANDOM-EX' } },
  }).finalize({ summary: { ...createEmptyScore(1), fast: 0, slow: 0 } });
  const target = prepare();
  expect(applyReplayArrangement(replay.chart.notes, target)).toEqual({ ok: true });
  expect(target.notes.map(({ channel, endSeconds }) => ({ channel, endSeconds }))).toEqual(
    chart.notes.map(({ channel, endSeconds }) => ({ channel, endSeconds })),
  );
});

test('CONVERGE dispatches to the distinct LR2 and beatoraja PMS algorithms', () => {
  const keys = resolveLaneOptionChannels('1P', '9');
  const source = () => [
    { channel: keys[0]!, seconds: 0 },
    { channel: keys[0]!, seconds: 0.126 },
  ];
  const lr2 = source(),
    beatoraja = source();
  applyRandomMode(lr2, keys, 'CONVERGE', () => 0, { ruleset: 'lr2', playVariant: '9' });
  applyRandomMode(beatoraja, keys, 'CONVERGE', () => 0, { ruleset: 'beatoraja', playVariant: '9' });
  expect(channelsOf(lr2)).toEqual([keys[4], keys[4]]);
  expect(channelsOf(beatoraja)).toEqual([keys[0], keys[0]]);
  expect(() => applyRandomMode([], KEYS_1P, 'CONVERGE', () => 0, { ruleset: 'beatoraja', playVariant: '7' })).toThrow(
    /PMS arrangement/,
  );
});

test('PMS RANDOM_PLAYABLE applies the exact permutation to visible, mine and invisible arrays', () => {
  const keys = resolveLaneOptionChannels('1P', '9');
  const notes = notesOn(keys);
  const mines = notesOn(keys);
  const hidden = notesOn(keys);
  applyRandomMode(notes, keys, 'RANDOM_PLAYABLE', () => 0, { ruleset: 'beatoraja', playVariant: '9' }, mines, hidden);
  // The visible nine-key chord forces the documented regular/mirror fallback.
  expect(channelsOf(notes)).toEqual(keys);
  expect(channelsOf(mines)).toEqual(keys);
  expect(channelsOf(hidden)).toEqual(keys);
  expect(() =>
    applyRandomMode([], KEYS_1P, 'RANDOM_PLAYABLE', () => 0, { ruleset: 'beatoraja', playVariant: '7' }),
  ).toThrow(/PMS arrangement/);
});

test('PMS playable S-RANDOM uses row-specific placement rather than a whole-chart permutation', () => {
  const keys = resolveLaneOptionChannels('1P', '9');
  const notes = [0, 0.001].map((seconds) => ({ channel: keys[0]!, seconds }));
  applyRandomMode(notes, keys, 'S_RANDOM_PLAYABLE', () => 0, { ruleset: 'beatoraja', playVariant: '9' });
  expect(channelsOf(notes)).toEqual([keys[0], keys[1]]);
  expect(() =>
    applyRandomMode([], KEYS_1P, 'S_RANDOM_PLAYABLE', () => 0, { ruleset: 'beatoraja', playVariant: '7' }),
  ).toThrow(/PMS arrangement/);
});

test.each(['1P', '2P'] as const)('S-RANDOM-EX includes %s scratch and holds its LN through the tail row', (side) => {
  const keys = resolveLaneOptionChannels(side, '14').slice(0, 2);
  const scratch = side === '1P' ? '16' : '26';
  const notes = [
    { channel: keys[0]!, seconds: 0, endSeconds: 1 },
    { channel: keys[1]!, seconds: 0.5 },
    { channel: keys[1]!, seconds: 1 },
    { channel: keys[1]!, seconds: 1.001 },
  ];
  applyRandomMode(notes, keys, 'S-RANDOM-EX', () => 0.99, { ruleset: 'beatoraja', scratchLanes: [scratch] });
  expect(channelsOf(notes)).toEqual([scratch, keys[1], keys[1], scratch]);
  expect(notes[0]!.endSeconds).toBe(1);
});

test('S-RANDOM-EX includes both wheel directions and uses 40ms rather than H-RANDOM threshold BPM', () => {
  const keys = resolveLaneOptionChannels('1P', '24');
  const notes = [0, 0.001].map((seconds) => ({ channel: keys[0]!, seconds }));
  applyRandomMode(notes, keys, 'S-RANDOM-EX', () => 0.99, {
    ruleset: 'beatoraja',
    scratchLanes: ['1P', '1Q'],
    hRandomThresholdBPM: 1000,
  });
  expect(channelsOf(notes)).toEqual(['1Q', '1P']);
  const lr2Notes = [0, 0.001].map((seconds) => ({ channel: keys[0]!, seconds }));
  applyRandomMode(lr2Notes, keys, 'S-RANDOM-EX', () => 0.99, {
    ruleset: 'lr2',
    scratchLanes: ['1P', '1Q'],
    hRandomThresholdBPM: 1000,
  });
  expect(channelsOf(lr2Notes)).toEqual(['1Q', '1P']);
});

test('LR2 RANDOM fixed-key selection pins the original key-1 axis, while nine-key RANDOM ignores it', () => {
  const notes = notesOn(KEYS_1P);
  applyRandomMode(notes, KEYS_1P, 'RANDOM', seededRandom(1), { ruleset: 'lr2', fixedLane: 4, playVariant: '7' });
  expect(notes[0]!.channel).toBe(KEYS_1P[3]);
  expect(channelsOf(notes).sort()).toEqual([...KEYS_1P].sort());
  const pms = resolveLaneOptionChannels('1P', '9');
  const ordinary = notesOn(pms),
    selected = notesOn(pms);
  applyRandomMode(ordinary, pms, 'RANDOM', seededRandom(1), { ruleset: 'lr2', playVariant: '9' });
  applyRandomMode(selected, pms, 'RANDOM', seededRandom(1), { ruleset: 'lr2', fixedLane: 4, playVariant: '9' });
  expect(selected).toEqual(ordinary);
});

test('SCATTER modes distinguish original outside-PMS placement from corrected nine-key placement', () => {
  const keys = resolveLaneOptionChannels('1P', '9', [{ channel: '22' }]);
  for (const [mode, target] of [
    ['SCATTER', '26'],
    ['SCATTER-CORRECTED', '25'],
  ] as const) {
    const notes = [{ channel: '11', seconds: 1 }];
    const mines = [{ channel: '22', seconds: 2 }];
    const hidden = [{ channel: '23', seconds: 1.5 }];
    applyRandomMode(notes, keys, mode, () => 0.999, { ruleset: 'lr2', playVariant: '9' }, mines, hidden);
    expect(notes[0]!.channel).toBe(target);
    expect(mines[0]!.channel).toBe(target === '26' ? '25' : '24');
    expect(hidden[0]!.channel).toBe('23');
  }
});

test('corrected SCATTER rejects charts other than nine-key ones before consuming randomness or mutating notes', () => {
  for (const options of [
    { ruleset: 'lr2', playVariant: '7' },
    { ruleset: 'beatoraja', playVariant: '7' },
  ] as const) {
    const notes = [{ channel: '11', seconds: 1 }];
    let draws = 0;
    expect(() =>
      applyRandomMode(
        notes,
        KEYS_7,
        'SCATTER-CORRECTED',
        () => {
          draws++;
          return 0;
        },
        options,
      ),
    ).toThrow();
    expect(notes).toEqual([{ channel: '11', seconds: 1 }]);
    expect(draws).toBe(0);
  }
});

describe('That-Which-Must-Not-Be-Named BATTLE random', () => {
  const lanes1P = resolveLaneOptionChannels('1P', '14');
  const lanes2P = resolveLaneOptionChannels('2P', '14');
  const battleNotes = (): Array<{ channel: string }> => [
    ...['11', '12', '13', '14', '15', '18', '19', '16'].map((channel) => ({ channel })),
    ...['21', '22', '23', '24', '25', '28', '29', '26'].map((channel) => ({ channel })),
  ];

  test('SYNCHRONIZE RANDOM gives both sides one permutation', () => {
    const notes = battleNotes();
    applyBattleRandomMode('SYNCHRONIZE-RANDOM', lanes1P, lanes2P, seededRandom(7), notes);
    const side1 = notes.slice(0, 7).map((note) => lanes1P.indexOf(note.channel));
    const side2 = notes.slice(8, 15).map((note) => lanes2P.indexOf(note.channel));
    expect(side2).toEqual(side1);
    expect(new Set(side1).size).toBe(7);
    expect([notes[7]!.channel, notes[15]!.channel]).toEqual(['16', '26']);
  });

  test('SYMMETRY RANDOM mirrors the 1P permutation on the 2P side', () => {
    const notes = battleNotes();
    const mines = [{ channel: '11' }, { channel: '21' }];
    applyBattleRandomMode('SYMMETRY-RANDOM', lanes1P, lanes2P, seededRandom(7), notes, mines);
    const side1 = notes.slice(0, 7).map((note) => lanes1P.indexOf(note.channel));
    const side2 = notes.slice(8, 15).map((note) => lanes2P.indexOf(note.channel));
    expect(side2).toEqual(side1.map((index) => 6 - index));
    expect(lanes2P.indexOf(mines[1]!.channel)).toBe(6 - lanes1P.indexOf(mines[0]!.channel));
  });
});

test('each 2P copy of a two-player chart pairs with the 1P object at its time and lane number', () => {
  const notes = [
    { channel: '11', seconds: 1 },
    { channel: '12', seconds: 1, endSeconds: 2 },
    { channel: '21', seconds: 1 },
    { channel: '22', seconds: 1, endSeconds: 2 },
    { channel: '21', seconds: 3 },
  ];
  const pairs = pairTwoPlayerTwins([notes]);
  expect(pairs.map(([second, first]) => [second, first])).toEqual([
    [notes[2], notes[0]],
    [notes[3], notes[1]],
  ]);
  // After 1P is shuffled, 2P takes its lanes.
  notes[0]!.channel = '15';
  for (const [second, first] of pairs) second.channel = `2${first.channel.slice(1)}`;
  expect(notes[2]!.channel).toBe('25');
});
