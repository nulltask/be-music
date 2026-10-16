import { describe, expect, test } from 'vite-plus/test';
import { resolveLaneOptionChannels } from '@be-music/player/core/lane-layout';
import { applyRandomMode, extractChartExtension, flipDpChannel, isChannelOnSide, shuffleArray } from './play-chart.ts';

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

function channelsOf(notes: readonly TestNote[]): string[] {
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

  test('MIRROR reverses the keys and leaves the scratch', () => {
    const notes = notesOn([...KEYS_7, '16']);
    applyRandomMode(notes, KEYS_1P, 'MIRROR', seededRandom(1));
    expect(channelsOf(notes)).toEqual(['19', '18', '15', '14', '13', '12', '11', '16']);
  });

  test('MIRROR reverses only the keys the chart uses, so a 5 KEY chart stays on its five lanes', () => {
    const notes = notesOn(['11', '12', '13', '14', '15']);
    applyRandomMode(notes, KEYS_1P, 'MIRROR', seededRandom(1));
    expect(channelsOf(notes)).toEqual(['15', '14', '13', '12', '11']);
  });

  test('mines and invisible notes follow the playable notes to their new lanes', () => {
    const notes = notesOn(['11', '12', '13']);
    const mines = notesOn(['11']);
    const invisible = notesOn(['13', '14']);
    applyRandomMode(notes, KEYS_1P, 'MIRROR', seededRandom(1), mines, invisible);
    expect(channelsOf(mines)).toEqual(['13']);
    // A lane no playable note uses (14) is not in the permutation, so its invisible note stays.
    expect(channelsOf(invisible)).toEqual(['11', '14']);
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

  test('S-RANDOM draws a permutation per chord, so the notes of a chord never share a lane', () => {
    const chords = [0, 1, 2, 3].map((beat) => notesOn(['11', '12', '13'], beat));
    const notes = chords.flat();
    applyRandomMode(notes, KEYS_1P, 'S-RANDOM', seededRandom(3));
    const random = seededRandom(3);
    for (const chord of chords) {
      const perm = shuffleArray(['11', '12', '13'], random);
      expect(channelsOf(chord)).toEqual(perm);
      expect(new Set(channelsOf(chord)).size).toBe(3);
    }
    expect(new Set(chords.map((chord) => channelsOf(chord).join())).size).toBeGreaterThan(1);
  });

  test('a 1P option leaves the 2P lanes alone', () => {
    const notes = notesOn(['11', '12', '21', '22', '26']);
    applyRandomMode(notes, KEYS_1P, 'MIRROR', seededRandom(1));
    expect(channelsOf(notes)).toEqual(['12', '11', '21', '22', '26']);
  });

  test('a chart on fewer than two keys is left as it is', () => {
    const notes = notesOn(['13', '13', '16']);
    applyRandomMode(notes, KEYS_1P, 'RANDOM', seededRandom(1));
    expect(channelsOf(notes)).toEqual(['13', '13', '16']);
  });
});

describe('flipDpChannel (DP FLIP)', () => {
  test('swaps the 1P and 2P sides of a lane', () => {
    expect(['11', '16', '19', '21', '26', '29'].map(flipDpChannel)).toEqual(['21', '26', '29', '11', '16', '19']);
  });

  test('leaves channels of no side as they are', () => {
    expect(['01', '04', 'D1', '31', '1', ''].map(flipDpChannel)).toEqual(['01', '04', 'D1', '31', '1', '']);
  });

  test('flipping twice puts every lane back', () => {
    const channels = ['11', '15', '16', '22', '28', '01'];
    expect(channels.map(flipDpChannel).map(flipDpChannel)).toEqual(channels);
  });
});

describe('isChannelOnSide', () => {
  test('sorts lanes by their side digit', () => {
    expect(isChannelOnSide('11', '1P')).toBe(true);
    expect(isChannelOnSide('16', '1P')).toBe(true);
    expect(isChannelOnSide('21', '1P')).toBe(false);
    expect(isChannelOnSide('26', '2P')).toBe(true);
    expect(isChannelOnSide('11', '2P')).toBe(false);
  });

  test('puts channels that are not lanes on neither side', () => {
    for (const channel of ['01', '1', '111']) {
      expect(isChannelOnSide(channel, '1P')).toBe(false);
      expect(isChannelOnSide(channel, '2P')).toBe(false);
    }
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
