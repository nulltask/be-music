import type { BeMusicJson } from '@be-music/json';
import { parseChart } from '@be-music/parser';
import { stitchNonstopCourse, type NonstopStitchMap } from '../../course/index.ts';

/**
 * Test support: the synthetic charts the engine characterization suite plays. Each is small (a few seconds at 120 BPM,
 * where a measure is 2 s and a sixteenth 0.125 s) and exercises one part of the engine. The comments give the chart
 * times the scripts in `engine-characterization.test.ts` aim at.
 */

const bms = (...lines: string[]): BeMusicJson => parseChart(lines.join('\n'), 'bms');

const header = (title: string, ...extra: string[]): string[] => [
  '#PLAYER 1',
  `#TITLE ${title}`,
  '#ARTIST characterization',
  '#BPM 120',
  '#RANK 2',
  '#WAV01 bgm.wav',
  '#WAV02 key-a.wav',
  '#WAV03 key-b.wav',
  '#WAV04 key-c.wav',
  '#WAV05 scratch.wav',
  ...extra,
];

/**
 * Taps on every lane kind of 7 KEY: 11 @ 0.5, 12 @ 0.75, 13 @ 1.0, scratch 16 @ 1.25, chord 14 + 15 @ 1.5, 18 @ 1.75,
 * 19 @ 2.0, 11 @ 2.5, 12 @ 3.0, 11 @ 3.5. BGM at 0 and 2.0, a BGM volume change at 1.0 and a key volume change at 2.0.
 */
export function basicChart(): BeMusicJson {
  return bms(
    ...header('basic', '#TOTAL 160'),
    '#00001:01',
    '#00097:0080',
    '#00011:00020000',
    '#00012:0000000300000000',
    '#00013:00000400',
    '#00016:0000000000050000',
    '#00014:00000002',
    '#00015:00000003',
    '#00018:0000000000000004',
    '#00101:01',
    '#00198:C0',
    '#00119:02',
    '#00111:00020002',
    '#00112:0003',
  );
}

/**
 * Long notes (`#LNTYPE 1`) under `#LNMODE lnMode` (none: the chart leaves it to the ruleset): 11 from 0.5 to 1.5,
 * 12 from 1.0 to 2.0, a tap on 13 @ 1.25, scratch 16 from 2.0 to 2.5, 14 from 2.5 to 3.5 and a tap on 15 @ 3.5.
 */
export function longNoteChart(lnMode?: 1 | 2 | 3): BeMusicJson {
  return bms(
    ...header(`long notes${lnMode === undefined ? '' : ` LNMODE ${lnMode}`}`, '#LNTYPE 1'),
    ...(lnMode === undefined ? [] : [`#LNMODE ${lnMode}`]),
    '#00001:01',
    '#00051:00020002',
    '#00052:00000300',
    '#00152:03',
    '#00013:0000000000040000',
    '#00156:05050000',
    '#00154:00020002',
    '#00115:00000004',
  );
}

/**
 * Mines: taps on 11 @ 0.5 and 12 @ 2.0, mines on 11 @ 1.0 and 1.5, on 12 @ 1.25 and on scratch 16 @ 2.5, with the
 * explosion sample `#WAV00`.
 */
export function mineChart(): BeMusicJson {
  return bms(
    ...header('mines', '#WAV00 explode.wav'),
    '#00001:01',
    '#00011:00020000',
    '#000D1:00000A0A',
    '#000D2:0000000000050000',
    '#00112:02',
    '#001D6:000A0000',
  );
}

/**
 * Tempo gimmicks: BPM 120, then 180 (channel 03) at 1.0, 240 (`#BPM01`, channel 08) at 2.0, a STOP of a half note
 * (`#STOP01 96`) at measure 1's middle, SCROLL 0.5 from 0.5 and SPEED 1.5 at measure 1. Notes on every quarter.
 */
export function tempoChart(): BeMusicJson {
  return bms(
    ...header('tempo', '#BPM01 240', '#STOP01 96', '#SCROLL01 0.5', '#SPEED01 1.5'),
    '#00001:01',
    '#00003:00B4',
    '#000SC:00010000',
    '#00011:00020202',
    '#00108:01',
    '#00109:0001',
    '#001SP:01',
    '#00112:02020202',
    '#00213:0202',
  );
}

/**
 * Judge rank changes: `#RANK 2` (NORMAL), `#EXRANK01 25` (narrower) from 1.0 and `#EXRANK02 200` (wider) from 2.0.
 * Taps on 11 @ 0.5, 12 @ 1.5, 13 @ 2.5 and 14 @ 3.0; mines on 15 @ 1.75 and 3.25 and an invisible note on 16 @ 2.25.
 */
export function exRankChart(withChanges = true): BeMusicJson {
  return bms(
    ...header('exrank', '#EXRANK01 25', '#EXRANK02 200'),
    '#00001:01',
    ...(withChanges ? ['#000A0:0001', '#001A0:02'] : []),
    '#00011:00020000',
    '#00012:00000002',
    '#000D5:000000000000000A',
    '#00113:00020000',
    '#00114:0002',
    '#00136:0003000000000000',
    '#001D5:00000000000A0000',
  );
}

/** Sixteenth notes over four lanes from 0.5 to 4.375: 32 notes, enough misses to empty any survival gauge. */
export function denseChart(): BeMusicJson {
  const lanes = ['11', '12', '13', '14'];
  const rows = lanes.map((lane, offset) => {
    const measure0 = Array.from({ length: 16 }, (_, slot) => (slot >= 4 && slot % 4 === offset ? '02' : '00'));
    const measure1 = Array.from({ length: 16 }, (_, slot) => (slot % 4 === offset ? '03' : '00'));
    const measure2 = Array.from({ length: 16 }, (_, slot) => (slot < 4 && slot % 4 === offset ? '04' : '00'));
    return [`#000${lane}:${measure0.join('')}`, `#001${lane}:${measure1.join('')}`, `#002${lane}:${measure2.join('')}`];
  });
  return bms(...header('dense', '#TOTAL 100'), '#00001:01', ...rows.flat());
}

/** The two stages of {@link nonstopCourse}: stage A at 120 BPM (`#RANK 3`), stage B at 150 BPM (`#RANK 0`). */
function nonstopStages(): BeMusicJson[] {
  const stageA = bms(
    '#PLAYER 1',
    '#TITLE stage A',
    '#BPM 120',
    '#RANK 3',
    '#WAV01 a-bgm.wav',
    '#WAV02 a-key.wav',
    '#00001:01',
    '#00011:0002',
    '#00012:00000002',
    '#00111:02',
  );
  const stageB = bms(
    '#PLAYER 1',
    '#TITLE stage B',
    '#BPM 150',
    '#RANK 0',
    '#WAV01 b-bgm.wav',
    '#WAV02 b-key.wav',
    '#00001:01',
    '#00013:0002',
    '#00114:0202',
  );
  return [stageA, stageB];
}

/** A two-stage LR2 NONSTOP course stitched into one chart (`stitchNonstopCourse`, CUT connection). */
export function nonstopCourse(): { chart: BeMusicJson; map: NonstopStitchMap } {
  const stitched = stitchNonstopCourse(
    nonstopStages().map((chart) => ({ chart })),
    { connections: ['cut'], title: 'nonstop' },
  );
  if (!stitched.ok) {
    throw new Error(`stitchNonstopCourse failed: ${stitched.reason}`);
  }
  return { chart: stitched.chart, map: stitched.map };
}
