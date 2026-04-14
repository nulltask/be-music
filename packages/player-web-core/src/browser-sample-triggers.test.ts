import { createEmptyJson } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import { collectBrowserSampleTriggers } from './browser-sample-triggers.ts';

describe('player-web-core browser sample triggers', () => {
  test('ignores landmine channels and LNOBJ end objects', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.bms.lnObjs = ['ZZ'];
    json.resources.wav['01'] = 'kick.wav';
    json.resources.wav['02'] = 'bgm.wav';
    json.events.push(
      {
        measure: 0,
        channel: '01',
        position: [0, 1],
        value: '02',
      },
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
      {
        measure: 1,
        channel: 'D1',
        position: [0, 1],
        value: '01',
      },
    );

    const triggers = collectBrowserSampleTriggers(json, undefined, {
      inferBmsLnTypeWhenMissing: true,
    });

    expect(
      triggers.map((trigger) => ({
        channel: trigger.channel,
        sampleKey: trigger.sampleKey,
      })),
    ).toEqual([
      { channel: '01', sampleKey: '02' },
      { channel: '11', sampleKey: '01' },
    ]);
  });
});
