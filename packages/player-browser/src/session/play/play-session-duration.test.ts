import { expect, test } from 'vite-plus/test';
import { PlaySession } from './play-session.ts';

// Read the session fact without starting a browser scene or an audio device.
function duration(chartDurationSeconds: number, engineSeconds?: number, chart = true): number {
  return PlaySession.prototype.resolveChartDurationSeconds.call({
    chart: chart ? {} : undefined,
    chartDurationSeconds,
    engineFrame: engineSeconds === undefined ? undefined : { totalSeconds: engineSeconds },
  } as PlaySession);
}

test('late engine presentation cues extend the browser duration and seek range after the last note', () => {
  expect(duration(1)).toBe(1);
  expect(duration(1, 7)).toBe(7);
  expect(duration(10, 7)).toBe(10);
  expect(duration(1, 7, false)).toBe(0);
});
