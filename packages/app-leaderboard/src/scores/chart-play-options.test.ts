import { describe, expect, it } from 'vite-plus/test';
import {
  createPlayFingerprintDocument,
  type ChartPlayOptions,
  type PlayerChartPlayOptions,
} from '@be-music/chart-model';
import { parseBMS } from '@be-music/chart-parser';
import type { BeMusicReplay } from '@be-music/player-engine/replay';
import { checkChartPlayOptions } from './chart-play-options.ts';

const document = (...options: string[]) =>
  createPlayFingerprintDocument(
    parseBMS(['#BPM 120', ...options.map((option) => `#OPTION ${option}`), '#00111:01', '#00116:01', ''].join('\n')),
    { chartPath: 'chart.bms' },
  );
const replay = (options: ChartPlayOptions | undefined, course?: 'grade' | 'nonstop', player?: PlayerChartPlayOptions) =>
  ({
    chart:
      options === undefined ? {} : { chartPlayOptions: { version: options.baseSpeed === undefined ? 1 : 2, options } },
    play: {
      ...(course === undefined ? {} : { course: { kind: course } }),
      ...(player === undefined ? {} : { playerChartPlayOptions: player }),
    },
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
    expect(checkChartPlayOptions(replay({ random: 'MIRROR' }), document())).toEqual(mismatch);
    expect(checkChartPlayOptions(replay({ notes: 'DOUBLE' }), document('774:NOTES_COPY'))).toEqual(mismatch);
    expect(checkChartPlayOptions(replay({}), { not: 'a play document' })).toEqual(mismatch);
  });

  it("accepts the player's own CRAZY judgment and NOTES options where the chart sets none (#1177, #1184, #1185)", () => {
    const mismatch = { ok: false, reason: 'chart-play-options-mismatch' };
    expect(
      checkChartPlayOptions(
        replay({ judge: 'GOOD2BAD', hellJudge: true }, undefined, { judge: 'GOOD2BAD', hellJudge: true }),
        document(),
      ),
    ).toEqual({ ok: true });
    expect(checkChartPlayOptions(replay({ notes: 'DBLCOPY' }), document('774:RANDOM_MIRROR'))).toEqual(mismatch);
    expect(
      checkChartPlayOptions(
        replay({ random: 'MIRROR', notes: 'DBLCOPY' }, undefined, { notes: 'DBLCOPY' }),
        document('774:RANDOM_MIRROR'),
      ),
    ).toEqual({ ok: true });
    // The chart's own choice wins within a family.
    expect(checkChartPlayOptions(replay({ judge: 'GOOD2BAD' }), document('774:CRAZY_GREAT2BAD'))).toEqual(mismatch);
    // A course stage leaves the player's COPY out as it leaves the chart's.
    expect(checkChartPlayOptions(replay({ notes: 'COPY' }, 'grade'), document())).toEqual(mismatch);
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

describe('checkChartPlayOptions, player options (#1243)', () => {
  it("names the player's options apart from the chart's, so a player's COPY cannot pass for the chart's (#1243)", () => {
    const mismatch = { ok: false, reason: 'chart-play-options-mismatch' };
    // The player's COPY recorded as the chart's would keep a record of the single-play chart.
    expect(checkChartPlayOptions(replay({ notes: 'COPY' }), document())).toEqual(mismatch);
    expect(checkChartPlayOptions(replay({ notes: 'COPY' }, undefined, { notes: 'COPY' }), document())).toEqual({
      ok: true,
    });
    // A chart's own COPY is not the player's.
    expect(
      checkChartPlayOptions(replay({ notes: 'COPY' }, undefined, { notes: 'COPY' }), document('774:NOTES_COPY')),
    ).toEqual(mismatch);
    // HELLJUDGE the player added next to the chart's GREAT2BAD is the player's alone.
    expect(
      checkChartPlayOptions(
        replay({ judge: 'GREAT2BAD', hellJudge: true }, undefined, { hellJudge: true }),
        document('774:CRAZY_GREAT2BAD'),
      ),
    ).toEqual({ ok: true });
    // In a course the player's DBLCOPY keeps its DOUBLE, and that is what the replay names.
    expect(checkChartPlayOptions(replay({ notes: 'DOUBLE' }, 'grade', { notes: 'DOUBLE' }), document())).toEqual({
      ok: true,
    });
  });
});
