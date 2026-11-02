import { describe, expect, test } from 'vite-plus/test';
import { longNoteChart } from './characterization/charts.ts';
import { command, observePlay, type CharacterizationPlay } from './characterization/harness.ts';

/** The `hell-charge` commands on `channel` of one play (the HCN on lane 11 runs 0.5 s .. 1.5 s), without the clock. */
async function hellChargeCommands(options: Partial<CharacterizationPlay> = {}, channel = '11'): Promise<string[]> {
  const observation = await observePlay({
    driver: 'manual',
    chart: longNoteChart(3),
    options: { judgeRuleset: 'beatoraja' },
    reportsKeyReleases: true,
    script: [
      { atMs: 500, down: ['11'] },
      { atMs: 800, up: ['11'] },
      { atMs: 1100, down: ['11'] },
    ],
    ...options,
  });
  return observation.ui
    .filter((entry) => entry.includes(` hell-charge ${channel} `))
    .map((entry) => entry.slice(entry.indexOf('hell-charge')));
}

describe('hell-charge UI commands', () => {
  test('a held HCN gains, drains when let go, gains again when pressed back, then passes at its tail', async () => {
    expect(await hellChargeCommands()).toEqual([
      'hell-charge 11 beat=1 state=gaining',
      'hell-charge 11 beat=1 state=draining',
      'hell-charge 11 beat=1 state=gaining',
      'hell-charge 11 beat=1 state=passed',
    ]);
  });

  test('a missed HCN head drains once judged, and a later press makes it gain', async () => {
    expect(await hellChargeCommands({ script: [{ atMs: 1000, down: ['11'] }] })).toEqual([
      'hell-charge 11 beat=1 state=draining',
      'hell-charge 11 beat=1 state=gaining',
      'hell-charge 11 beat=1 state=passed',
    ]);
  });

  test('only a switch is sent: repeated presses on a gaining lane send nothing more', async () => {
    const commands = await hellChargeCommands({
      script: [
        { atMs: 500, down: ['11'] },
        { atMs: 1600, up: ['11'] },
      ],
    });
    expect(commands).toEqual(['hell-charge 11 beat=1 state=gaining', 'hell-charge 11 beat=1 state=passed']);
  });

  test('a replay sends the same commands as the play it records', async () => {
    const live = await hellChargeCommands();
    const replayInputs = [
      { timeUs: 500000, action: 'down' as const, channels: ['11'] },
      { timeUs: 800000, action: 'up' as const, channels: ['11'] },
      { timeUs: 1100000, action: 'down' as const, channels: ['11'] },
    ].map((input, seq) => ({ ...input, seq }));
    const replay = await hellChargeCommands({
      script: [],
      options: { judgeRuleset: 'beatoraja', replayInputs },
    });
    expect(replay).toEqual(live);
  });

  test('a replay seek into a draining HCN announces it again', async () => {
    const replayInputs = [
      { timeUs: 500000, action: 'down' as const, channels: ['11'] },
      { timeUs: 800000, action: 'up' as const, channels: ['11'] },
    ].map((input, seq) => ({ ...input, seq }));
    const commands = await hellChargeCommands({
      script: [command(200, { kind: 'seek', seconds: 1 })],
      options: { judgeRuleset: 'beatoraja', replayInputs },
    });
    expect(commands).toEqual(['hell-charge 11 beat=1 state=draining', 'hell-charge 11 beat=1 state=passed']);
  });

  test('a hell-charge back-spin scratch drains when the spin stops and gains when it spins again', async () => {
    const commands = await hellChargeCommands(
      {
        script: [
          { atMs: 2000, down: ['16'] },
          { atMs: 2080, up: ['16'] },
          { atMs: 2150, down: ['16'] },
        ],
      },
      '16',
    );
    expect(commands).toEqual([
      'hell-charge 16 beat=4 state=gaining',
      'hell-charge 16 beat=4 state=draining',
      'hell-charge 16 beat=4 state=gaining',
      'hell-charge 16 beat=4 state=passed',
    ]);
  });

  test('CN, LR2 and AUTO play send none', async () => {
    expect(await hellChargeCommands({ chart: longNoteChart(2) })).toEqual([]);
    expect(await hellChargeCommands({ options: { judgeRuleset: 'lr2' } })).toEqual([]);
    expect(await hellChargeCommands({ driver: 'auto', script: [] })).toEqual([]);
  });
});
