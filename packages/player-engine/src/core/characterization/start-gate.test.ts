import { describe, expect, test } from 'vite-plus/test';
import { basicChart } from './charts.ts';
import { command, observePlay } from './harness.ts';

describe('chart start gate', () => {
  test('waits for START before audio or judging, and applies only the last intro seek', async () => {
    const play = await observePlay({
      driver: 'auto',
      chart: basicChart(),
      options: { waitForStart: true },
      script: [
        command(100, { kind: 'seek', seconds: 1 }),
        command(300, { kind: 'seek', seconds: 2.2 }),
        command(600, { kind: 'start' }),
      ],
    });
    expect(play.audio.find((entry) => entry.endsWith(' start'))).toBe('600.000 start');
    expect(play.audio.find((entry) => entry.includes(' seek '))).toBe('600.000 seek 2.2');
    expect(play.frames.generations).toHaveLength(1);
    expect(play.frames.generations?.[0]).toContain('600.000 generation=1 seconds=2.2 ');
  });
  test('START never bypasses the configured lead-in and is idempotent', async () => {
    const play = await observePlay({
      driver: 'auto',
      chart: basicChart(),
      options: { waitForStart: true, leadInMs: 500 },
      script: [command(100, { kind: 'start' }), command(600, { kind: 'start' })],
    });
    expect(play.audio.filter((entry) => entry.endsWith(' start'))).toEqual(['500.000 start']);
    expect(play.summary?.perfect).toBe(11);
  });
  test('an interrupt while waiting disposes the session without starting audio', async () => {
    const play = await observePlay({
      driver: 'manual',
      chart: basicChart(),
      options: { waitForStart: true },
      script: [command(500, { kind: 'interrupt', reason: 'escape' })],
    });
    expect(play.outcome).toBe('completed');
    expect(play.replay?.play).toMatchObject({ aborted: true, abortedAtUs: 0 });
    expect(play.audio.some((entry) => entry.endsWith(' start'))).toBe(false);
    expect(play.audio).toContain('500.000 dispose');
  });
  test('an intro pause remains paused after START and its selected position', async () => {
    const play = await observePlay({
      driver: 'auto',
      chart: basicChart(),
      options: { waitForStart: true },
      script: [
        command(100, { kind: 'toggle-pause' }),
        command(200, { kind: 'seek', seconds: 2.2 }),
        command(600, { kind: 'start' }),
        command(900, { kind: 'toggle-pause' }),
      ],
    });
    expect(play.frames.generations?.[0]).toMatch(/600.000 generation=1 seconds=2.2 .*paused/);
    expect(play.audio).toContain('600.000 pause');
    expect(play.audio).toContain('900.000 resume');
  });
});

test('seeking to the end during a held outro does not notify settlement twice', async () => {
  const play = await observePlay({
    driver: 'auto',
    chart: basicChart(),
    script: [command(5000, { kind: 'seek', seconds: 999 })],
    holdAfterChart: { releaseAfterMs: 3000 },
  });
  expect(play.host.filter((entry) => entry.includes('hold settled'))).toHaveLength(1);
});
