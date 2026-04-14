import { createEmptyJson } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import { createTimingResolver } from './timing.ts';
import { extractWebTimedNotes } from './web-playable-notes.ts';

describe('player-web-core gameplay timing', () => {
  test('timing resolver applies STOP duration to later beats', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.resources.stop['01'] = 192;
    json.events.push({
      measure: 1,
      channel: '09',
      position: [0, 1],
      value: '01',
    });

    const resolver = createTimingResolver(json);

    expect(resolver.beatToSeconds(4)).toBeCloseTo(2, 6);
    expect(resolver.beatToSeconds(8)).toBeCloseTo(6, 6);
  });

  test('extractWebTimedNotes resolves LNOBJ long notes and suppresses the end object', () => {
    const json = createEmptyJson('bms');
    json.bms.lnObjs = ['ZZ'];
    json.events.push(
      {
        measure: 0,
        channel: '11',
        position: [0, 1],
        value: '01',
      },
      {
        measure: 1,
        channel: '11',
        position: [0, 1],
        value: 'ZZ',
      },
    );

    const timed = extractWebTimedNotes(json);

    expect(timed.playableNotes).toHaveLength(1);
    expect(timed.playableNotes[0]!.channel).toBe('11');
    expect(timed.playableNotes[0]!.beat).toBeCloseTo(0, 6);
    expect(timed.playableNotes[0]!.endBeat).toBeCloseTo(4, 6);
  });
});
