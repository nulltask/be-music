import { resolveChart } from '@be-music/chart';
import { createEmptyJson } from '@be-music/json';
import { parseChart } from '@be-music/parser';
import { describe, expect, test } from 'vite-plus/test';
import { stitchNonstopCourse } from './compose.ts';

const bms = (...lines: string[]) => parseChart(lines.join('\n'), 'bms');

/** Stage A: 120 BPM, a note every measure on lanes 1 / 2, BGM at measure 1, last note at measure 4. */
const stageA = bms(
  '#BPM 120',
  '#WAV01 a1.wav',
  '#WAV02 a2.wav',
  '#WAV0A bgm-a.wav',
  '#BMP01 a.bmp',
  '#00101:0A',
  '#00104:01',
  '#00111:01',
  '#00212:02',
  '#00311:01',
  '#00412:02',
);
/** Stage B: 180 BPM, first note at measure 2, a STOP at measure 3, a long note at measure 4. */
const stageB = bms(
  '#BPM 180',
  '#STOP01 96',
  '#WAV01 b1.wav',
  '#WAV0A bgm-b.wav',
  '#00101:0A',
  '#00211:01',
  '#00309:01',
  '#00313:01',
  '#00451:0101',
  '#00511:01',
);

function noteSeconds(chart: ReturnType<typeof resolveChart>): number[] {
  return chart.notes.map((note) => Math.round(note.seconds * 10000) / 10000);
}

describe('stitchNonstopCourse', () => {
  test('keeps every note of every stage at its placed time', () => {
    const result = stitchNonstopCourse([{ chart: stageA }, { chart: stageB }], { connections: ['fade'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [a, b] = result.map.stages.map((stage) => stage.placement);
    const expected = [
      ...resolveChart(stageA).notes.map((note) => a!.offsetSeconds + note.seconds / a!.rate),
      ...resolveChart(stageB).notes.map((note) => b!.offsetSeconds + note.seconds / b!.rate),
    ]
      .map((seconds) => Math.round(seconds * 10000) / 10000)
      .sort((left, right) => left - right);
    const stitched = resolveChart(result.chart);
    const actual = noteSeconds(stitched).sort((left, right) => left - right);
    expect(actual).toHaveLength(expected.length);
    actual.forEach((seconds, index) => expect(seconds).toBeCloseTo(expected[index]!, 3));
    // Stage B's first note (local measure 2) lands on stage A's last-measure line (measure 4, 8 s).
    expect(Math.min(...stitched.notes.filter((note) => note.seconds > 7).map((note) => note.seconds))).toBeCloseTo(
      8,
      3,
    );
    // The long note keeps its length.
    const long = stitched.notes.find((note) => note.kind === 'ln')!;
    expect(long.endSeconds! - long.seconds).toBeCloseTo(240 / 180 / 2, 3);
  });

  test('keeps the STOP of a stage inside its window, at 150 BPM', () => {
    const result = stitchNonstopCourse([{ chart: stageA }, { chart: stageB }], { connections: ['fade'] });
    if (!result.ok) throw new Error('stitch failed');
    const stitched = resolveChart(result.chart);
    expect(result.chart.metadata.bpm).toBe(150);
    expect(stitched.timing.stopPoints).toHaveLength(1);
    // STOP 96 at 180 BPM is half a measure: 2/3 s.
    expect(stitched.timing.stopPoints[0]!.seconds).toBeCloseTo((96 / 192) * (240 / 180), 6);
  });

  test("shows each stage's bar lines inside its window", () => {
    const result = stitchNonstopCourse([{ chart: stageA }, { chart: stageB }], { connections: ['fade'] });
    if (!result.ok) throw new Error('stitch failed');
    const stitched = resolveChart(result.chart);
    const lines = stitched.barLines
      .map((beat) => stitched.timing.beatToSeconds(beat))
      .filter((seconds) => seconds < 12);
    // Stage A: every 2 s up to its boundary at 8 s. Stage B (4/3 s a measure) from the line nearest its first note,
    // with its STOP (2/3 s) after its measure 3.
    const expected = [0, 2, 4, 6, 8, 8 + 4 / 3, 8 + 8 / 3 + 2 / 3];
    expect(lines).toHaveLength(expected.length);
    lines.forEach((seconds, index) => expect(seconds).toBeCloseTo(expected[index]!, 3));
  });

  test("renumbers each stage's keys into one base-62 space and records them per stage", () => {
    const result = stitchNonstopCourse([{ chart: stageA }, { chart: stageB }], {
      connections: ['cut'],
      assetPath: (stage, kind, path) => `s${stage}/${kind}/${path}`,
    });
    if (!result.ok) throw new Error('stitch failed');
    expect(result.chart.bms.base).toBe(62);
    const [a, b] = result.map.stages;
    expect(a!.wavKeys.map((key) => result.chart.resources.wav[key])).toEqual(
      expect.arrayContaining(['s0/wav/a1.wav', 's0/wav/a2.wav', 's0/wav/bgm-a.wav']),
    );
    expect(b!.wavKeys.map((key) => result.chart.resources.wav[key])).toEqual(
      expect.arrayContaining(['s1/wav/b1.wav', 's1/wav/bgm-b.wav']),
    );
    expect(new Set([...a!.wavKeys, ...b!.wavKeys]).size).toBe(a!.wavKeys.length + b!.wavKeys.length);
    expect(a!.bmpKeys.map((key) => result.chart.resources.bmp[key])).toEqual(['s0/bmp/a.bmp']);
  });

  test('times the fades and the LR2 stage marker from the connection', () => {
    const cut = stitchNonstopCourse([{ chart: stageA }, { chart: stageB }], { connections: ['cut'] });
    const blank = stitchNonstopCourse([{ chart: stageA }, { chart: stageB }], { connections: ['blank1'] });
    if (!cut.ok || !blank.ok) throw new Error('stitch failed');
    const boundary = cut.map.stages[0]!.placement.boundarySeconds;
    expect(cut.map.stages[0]).toMatchObject({
      soundFadeOut: { start: boundary, end: boundary + 0.2 },
      bgaFadeOut: { start: boundary, end: boundary + 3 },
      lr2StageMarker: false,
    });
    expect(cut.map.stages[1]).toMatchObject({
      soundFadeIn: { start: boundary - 0.2, end: boundary },
      bgaFadeIn: { start: boundary - 3, end: boundary },
      windowStart: boundary,
      lr2StageMarker: false,
    });
    expect(blank.map.stages[0]!.soundFadeOut).toBeUndefined();
    expect(blank.map.stages[1]).toMatchObject({ lr2StageMarker: true, soundFadeIn: { end: boundary } });
  });

  test("turns a later stage's note that lands before the previous stage's last note into background sound", () => {
    // Stage C's first note is at its measure 2, but a second note sits at measure 1.5: placed before stage A's last
    // note, it becomes BGM.
    const stageC = bms('#BPM 120', '#WAV01 c.wav', '#00111:0001', '#00211:01', '#00311:01');
    const result = stitchNonstopCourse([{ chart: stageA }, { chart: stageC }], { connections: ['fade'] });
    if (!result.ok) throw new Error('stitch failed');
    const stitched = resolveChart(result.chart);
    expect(stitched.notes).toHaveLength(resolveChart(stageA).notes.length + 2);
  });

  test("maps each stage's BPM readout", () => {
    const intended = stitchNonstopCourse([{ chart: stageA }, { chart: stageB }], { connections: ['fade'] });
    if (!intended.ok) throw new Error('stitch failed');
    const [a, b] = intended.map.stages.map((stage) => stage.placement);
    expect(intended.chart.metadata.bpm).toBe(150);
    expect(intended.map.tempo).toEqual([
      { seconds: 0, bpm: 120 },
      { seconds: a!.boundarySeconds, bpm: 180 },
    ]);

    const lr2 = stitchNonstopCourse([{ chart: stageA }, { chart: stageB }], {
      connections: ['fade'],
      placement: 'lr2',
    });
    if (!lr2.ok) throw new Error('stitch failed');
    expect(lr2.map.tempo[1]).toEqual({ seconds: b!.offsetSeconds, bpm: 180 });
  });

  test('refuses bmson stages and a course past the key space', () => {
    expect(stitchNonstopCourse([{ chart: createEmptyJson('bmson') }], { connections: [] })).toEqual({
      ok: false,
      reason: 'bmson',
      stage: 0,
    });
    // Three stages using every base-36 key (1295 each) need 3885 stitched keys, past the 3843 base 62 holds.
    const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const crowded = createEmptyJson('bms');
    for (let index = 1; index < 36 * 36; index += 1) {
      const key = `${digits[Math.floor(index / 36)]}${digits[index % 36]}`;
      crowded.resources.wav[key] = `${key}.wav`;
      crowded.events.push({ measure: Math.floor(index / 16), channel: '01', position: [index % 16, 16], value: key });
    }
    const crowdedStage = { chart: crowded };
    expect(stitchNonstopCourse([crowdedStage, crowdedStage], { connections: ['fade'] }).ok).toBe(true);
    expect(stitchNonstopCourse([crowdedStage, crowdedStage, crowdedStage], { connections: [] })).toMatchObject({
      ok: false,
      reason: 'id-space',
    });
    expect(stitchNonstopCourse([], { connections: [] })).toEqual({ ok: false, reason: 'no-stage' });
  });
});
