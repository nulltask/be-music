import { describe, expect, test } from 'vite-plus/test';
import { parseLRX } from '../../chart-parser/src/index.ts';
import type { BeMusicEvent } from '../../chart-source/src/index.ts';
import type { AudioSession, PlayerOptions } from './index.ts';
import type { ReplayInputEvent } from './replay/format.ts';
import { manualPlay } from './test-support/node-audio-player.ts';
import { createScheduledInputRuntime } from './test-support/player-fixtures.ts';

// BPM 120: 480 ticks is 0.5 s. Each `p` sounds as `0p + 1` (`p="0"` is `01`).
const chart = (...notes: string[]) =>
  parseLRX({
    lrs: [
      '<LRS>',
      '<n c="301" s="0" p="120" />',
      '<n c="300" s="0" />',
      ...notes,
      '<n c="309" s="3840" />',
      '</LRS>',
    ].join(''),
  });

/** A tap of lane 1 at each second: down, then up 50 ms later. */
function taps(...seconds: number[]): ReplayInputEvent[] {
  return seconds.flatMap((at, index) => [
    { seq: index * 2, timeUs: at * 1e6, action: 'down', channels: ['11'], source: 0 },
    { seq: index * 2 + 1, timeUs: at * 1e6 + 50_000, action: 'up', channels: ['11'], source: 0 },
  ]);
}

async function sounds(
  json: ReturnType<typeof chart>,
  judgeRuleset: 'lr2' | 'plugout',
  replayInputs: ReplayInputEvent[],
): Promise<string[]> {
  const played: string[] = [];
  const session: AudioSession = {
    backendLabel: 'recording-audio',
    chartStartDelayMs: 0,
    start: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    finish: async () => undefined,
    dispose: async () => undefined,
    triggerEvent: (event: BeMusicEvent) => {
      played.push(event.value);
    },
    stopChannel: () => undefined,
  };
  const options: PlayerOptions = {
    speed: 1,
    leadInMs: 0,
    audio: true,
    tui: false,
    writeOutput: () => undefined,
    judgeRuleset,
    replayInputs,
    createAudioSession: async () => session,
    createInputRuntime: createScheduledInputRuntime([
      { delayMs: 4000, command: { kind: 'interrupt', reason: 'escape' } },
    ]),
  };
  await manualPlay(json, options);
  return played;
}

describe('plugout lane sounds', () => {
  test('a press with nothing to judge plays the last note a press judged, from the first note on', async () => {
    // Notes at 1 s, 2 s and 3 s. Presses: before any window, on the first note, then after missing the second.
    const json = chart('<n c="1" s="960" p="0" />', '<n c="1" s="1920" p="1" />', '<n c="1" s="2880" p="2" />');
    const inputs = taps(0.3, 1, 2.4);
    expect(await sounds(json, 'plugout', inputs)).toEqual(['01', '01', '01']);
    // LR2 plays nothing before the first window opens, and the missed note once its window has.
    expect(await sounds(json, 'lr2', inputs)).toEqual(['01', '02']);
  }, 20_000);

  test('a hidden note that played on the lane takes over until the next judged press', async () => {
    // A note at 1 s, a hidden note (`02`) at 1.5 s that also plays in the background, a note at 3 s.
    const json = chart('<n c="1" s="960" p="0" />', '<n c="1" s="1440" p="1" dmg="0" />', '<n c="1" s="2880" p="2" />');
    expect(await sounds(json, 'plugout', taps(1, 2, 3, 3.5))).toEqual(['01', '02', '02', '03', '03']);
  }, 20_000);

  test("letting go of a long note moves the sound to the lane's next note", async () => {
    // A long note from 1 s to 1.5 s, a note at 2.5 s; the empty press comes at 1.8 s.
    const json = chart('<n c="1" s="960" e="1440" p="0" />', '<n c="1" s="2400" p="1" />');
    const inputs: ReplayInputEvent[] = [
      { seq: 0, timeUs: 1_000_000, action: 'down', channels: ['11'], source: 0 },
      { seq: 1, timeUs: 1_500_000, action: 'up', channels: ['11'], source: 0 },
      ...taps(1.8).map((input, index) => ({ ...input, seq: 2 + index })),
    ];
    expect(await sounds(json, 'plugout', inputs)).toEqual(['01', '02']);
    expect(await sounds(json, 'lr2', inputs)).toEqual(['01', '01']);
  }, 20_000);
});
