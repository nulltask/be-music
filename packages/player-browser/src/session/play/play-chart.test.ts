import { resolveChart, type ChartPlayVariant } from '@be-music/chart-model';
import { parseChart } from '@be-music/chart-parser';
import { preparePlaybackChart } from '@be-music/player-engine';
import { createReplayRecorder } from '@be-music/player-engine/replay';
import { createEmptyScore } from '@be-music/player-engine/ruleset';
import { applyReplayArrangement } from '../../chart/replay-arrangement.ts';
import { describe, expect, test } from 'vite-plus/test';
import { resolveLaneOptionChannels } from '@be-music/player-engine/lanes';
import { applyRandomMode, extractChartExtension, flipDPChannel, shuffleArray } from './play-chart.ts';

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

  test('SCATTER draws the same chart-wide permutation as RANDOM', () => {
    const random = notesOn(KEYS_7);
    const scatter = notesOn(KEYS_7);
    applyRandomMode(random, KEYS_1P, 'RANDOM', seededRandom(42));
    applyRandomMode(scatter, KEYS_1P, 'SCATTER', seededRandom(42));
    expect(channelsOf(scatter)).toEqual(channelsOf(random));
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
