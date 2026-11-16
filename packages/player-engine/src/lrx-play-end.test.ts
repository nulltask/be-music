import { describe, expect, test } from 'vite-plus/test';
import { parseLRX } from '../../chart-parser/src/index.ts';
import type { PlayerOptions } from './index.ts';
import { manualPlay } from './test-support/node-audio-player.ts';
import { createScheduledInputRuntime } from './test-support/player-fixtures.ts';

// BPM 120: 480 ticks is 0.5 s.
const chart = (...notes: string[]) =>
  parseLRX({ lrs: `<LRS><n c="301" s="0" p="120" /><n c="300" s="0" />${notes.join('')}</LRS>` });

/** The play length the engine prepares for `json`. */
async function preparedSeconds(json: ReturnType<typeof chart>): Promise<number | undefined> {
  let totalSeconds: number | undefined;
  const options: PlayerOptions = {
    speed: 1,
    leadInMs: 0,
    audio: false,
    tui: false,
    writeOutput: () => undefined,
    judgeRuleset: 'plugout',
    onLog: (entry) => {
      if (entry.event === 'playback.prepared') totalSeconds = entry.fields?.totalSeconds as number;
    },
    createInputRuntime: createScheduledInputRuntime([{ delayMs: 0, command: { kind: 'interrupt', reason: 'escape' } }]),
  };
  await manualPlay(json, options);
  return totalSeconds;
}

describe('LRX play length', () => {
  test('ends at the end-of-song note', async () => {
    expect(
      await preparedSeconds(
        chart('<n c="1" s="960" p="0" />', '<n c="100" s="1440" p="1" />', '<n c="309" s="2880" />'),
      ),
    ).toBe(3);
  });

  test('without one, ends 3 s after the last sound note, a BGM note included', async () => {
    expect(await preparedSeconds(chart('<n c="1" s="960" p="0" />', '<n c="100" s="1440" p="1" />'))).toBe(4.5);
  });
});
