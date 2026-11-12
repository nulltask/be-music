import { describe, expect, it } from 'vite-plus/test';
import { createPlayFingerprintDocument, type ChartPlayOptions } from '@be-music/chart-model';
import { parseBMS } from '@be-music/chart-parser';
import type { BeMusicReplay } from '@be-music/player-engine/replay';
import { checkChartPlayOptions } from './chart-play-options.ts';

const document = (...options: string[]) =>
  createPlayFingerprintDocument(
    parseBMS(['#BPM 120', ...options.map((option) => `#OPTION ${option}`), '#00111:01', '#00116:01', ''].join('\n')),
    { chartPath: 'chart.bms' },
  );
const replay = (options: ChartPlayOptions | undefined, course?: 'grade' | 'nonstop') =>
  ({
    chart:
      options === undefined ? {} : { chartPlayOptions: { version: options.baseSpeed === undefined ? 1 : 2, options } },
    play: course === undefined ? {} : { course: { kind: course } },
  }) as unknown as Pick<BeMusicReplay, 'chart' | 'play'>;

describe('checkChartPlayOptions (#932)', () => {
  it('accepts a replay that records exactly the options its chart runs', () => {
    expect(checkChartPlayOptions(replay(undefined), document())).toEqual({ ok: true });
    expect(checkChartPlayOptions(replay({}), document())).toEqual({ ok: true });
    expect(
      checkChartPlayOptions(
        replay({ notes: 'COPY', random: 'MIRROR' }),
        document('774:RANDOM_MIRROR', '774:NOTES_COPY'),
      ),
    ).toEqual({ ok: true });
  });

  it('rejects a replay that strips, adds or changes the chart options', () => {
    const mismatch = { ok: false, reason: 'chart-play-options-mismatch' };
    expect(checkChartPlayOptions(replay(undefined), document('774:CRAZY_HELLJUDGE'))).toEqual(mismatch);
    expect(checkChartPlayOptions(replay({ hellJudge: true }), document())).toEqual(mismatch);
    expect(checkChartPlayOptions(replay({ notes: 'DOUBLE' }), document('774:NOTES_COPY'))).toEqual(mismatch);
    expect(checkChartPlayOptions(replay({}), { not: 'a play document' })).toEqual(mismatch);
  });

  it('narrows the chart options to a course stage, and expects none in a NONSTOP run', () => {
    expect(checkChartPlayOptions(replay({}, 'grade'), document('774:NOTES_COPY'))).toEqual({ ok: true });
    expect(checkChartPlayOptions(replay({ notes: 'DOUBLE' }, 'grade'), document('774:NOTES_DBLCOPY'))).toEqual({
      ok: true,
    });
    expect(checkChartPlayOptions(replay({ notes: 'COPY' }, 'grade'), document('774:NOTES_COPY')).ok).toBe(false);
    expect(checkChartPlayOptions(replay(undefined, 'nonstop'), undefined)).toEqual({ ok: true });
    expect(checkChartPlayOptions(replay({ random: 'MIRROR' }, 'nonstop'), undefined).ok).toBe(false);
  });
});

it('checks the replay’s authored BASE-SPEED against the chart and preserves NONSTOP policy', () => {
  const chart = document('774:CRA-RHS3');
  expect(checkChartPlayOptions(replay({ baseSpeed: 2 }), chart)).toEqual({ ok: true });
  expect(checkChartPlayOptions(replay(undefined), chart)).toEqual({ ok: false, reason: 'chart-play-options-mismatch' });
  expect(checkChartPlayOptions(replay({ baseSpeed: 1.5 }), chart)).toEqual({
    ok: false,
    reason: 'chart-play-options-mismatch',
  });
  expect(checkChartPlayOptions(replay({ baseSpeed: 2 }, 'grade'), chart)).toEqual({ ok: true });
  expect(checkChartPlayOptions(replay(undefined, 'nonstop'), chart)).toEqual({ ok: true });
});
