import { resolveChart } from '@be-music/chart-model';
import { createEmptyJSON } from '@be-music/chart-source';
import { parseChart } from '@be-music/chart-parser';
import { describe, expect, test } from 'vite-plus/test';
import { resolveChartRulesetFacts } from '../../core/play-chart.ts';
import { resolveRuleset } from '../../ruleset/index.ts';
import { NONSTOP_STITCH_VERSION, stitchNonstopCourse } from './compose.ts';

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

  test("maps each stage's BPM readout and judge rank", () => {
    const rankedB = { ...stageB, metadata: { ...stageB.metadata, rank: 1 } };
    const intended = stitchNonstopCourse([{ chart: stageA }, { chart: rankedB }], { connections: ['fade'] });
    if (!intended.ok) throw new Error('stitch failed');
    const [a, b] = intended.map.stages.map((stage) => stage.placement);
    expect(intended.chart.metadata.bpm).toBe(150);
    expect(intended.map.tempo).toEqual([
      { seconds: 0, bpm: 120 },
      { seconds: a!.boundarySeconds, bpm: 180 },
    ]);
    // Halfway between stage A's last note and stage B's first, which both land on the 8 s line.
    expect(intended.map.stageRanks).toHaveLength(1);
    expect(intended.map.stageRanks[0]).toMatchObject({ rank: 1, table: 'chart' });
    expect(intended.map.stageRanks[0]!.seconds).toBeCloseTo(8, 6);

    const lr2 = stitchNonstopCourse([{ chart: stageA }, { chart: rankedB }], {
      connections: ['fade'],
      placement: 'lr2',
    });
    if (!lr2.ok) throw new Error('stitch failed');
    expect(lr2.map.tempo[1]).toEqual({ seconds: b!.offsetSeconds, bpm: 180 });
    expect(lr2.map.stageRanks).toEqual([{ seconds: b!.offsetSeconds, rank: 1, table: 'lr2-nonstop' }]);
  });

  test('refuses bmson under LR2 placement and BMS courses past the key space', () => {
    expect(stitchNonstopCourse([{ chart: createEmptyJSON('bmson') }], { connections: [], placement: 'lr2' })).toEqual({
      ok: false,
      reason: 'bmson',
      stage: 0,
    });
    expect(stitchNonstopCourse([{ chart: createEmptyJSON('json') }], { connections: [] })).toEqual({
      ok: false,
      reason: 'bmson',
      stage: 0,
    });
    // Three stages using every base-36 key (1295 each) need 3885 stitched keys, past the 3843 base 62 holds.
    const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const crowded = createEmptyJSON('bms');
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
    // Stitching rules this build does not know are refused, not guessed at.
    expect(stitchNonstopCourse([], { connections: [], stitch: NONSTOP_STITCH_VERSION + 1 })).toEqual({
      ok: false,
      reason: 'stitch-version',
    });
  });
});

/** A sliced sample, a charge tail, a hidden keysound, a mine and three BGA layers. */
function bmsonStage(judgeRank = 125) {
  return parseChart(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, judge_rank: judgeRank, total: 100, resolution: 240, mode_hint: 'beat-7k' },
      sound_channels: [
        {
          name: 'sliced.wav',
          notes: [
            { x: 1, y: 0, c: false },
            { x: 2, y: 240, c: true },
            { x: 3, y: 480, l: 240, t: 2, c: true },
            { x: 4, y: 960, c: false },
          ],
        },
      ],
      key_channels: [{ name: 'hidden.wav', notes: [{ x: 5, y: 480 }] }],
      mine_channels: [{ name: 'mine.wav', notes: [{ x: 6, y: 720, damage: 12.5 }] }],
      bga: {
        bga_header: [
          { id: 1, name: 'base.png' },
          { id: 2, name: 'layer.png' },
          { id: 3, name: 'poor.png' },
        ],
        bga_events: [{ y: 0, id: 1 }],
        layer_events: [{ y: 240, id: 2 }],
        poor_events: [{ y: 480, id: 3 }],
      },
    }),
    'bmson',
  );
}

describe('bmson NONSTOP stitching', () => {
  test.each([false, true])(
    'preserves slices, long notes, hidden objects, mines and BGA (BMS first: %s)',
    (bmsFirst) => {
      const bmson = bmsonStage();
      const stages = bmsFirst ? [stageA, bmson] : [bmson, stageA];
      const result = stitchNonstopCourse(
        stages.map((chart) => ({ chart })),
        {
          connections: ['blank2'],
          placement: 'intended',
          assetPath: (stage, _kind, path) => `s${stage}/${path}`,
        },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.chart.sourceFormat).toBe('bmson');
      const own = bmsFirst ? 1 : 0;
      const placement = result.map.stages[own]!.placement;
      const chart = resolveChart(result.chart);
      const sliced = chart.sampleTriggers.filter((trigger) => trigger.samplePath === `s${own}/sliced.wav`);
      expect(sliced.map((trigger) => trigger.sampleOffsetSeconds)).toEqual([0, 0.5, 1, 0]);
      expect(sliced.map((trigger) => trigger.event.bmson?.c)).toEqual([false, true, true, false]);
      expect(sliced[0]!.seconds).toBeCloseTo(placement.offsetSeconds, 3);
      expect(chart.notes.filter((note) => note.kind === 'ln')).toHaveLength(1);
      const long = chart.notes.find((note) => note.kind === 'ln')!;
      expect(long.lnMode).toBe(2);
      expect(long.endSeconds! - long.seconds).toBeCloseTo(0.5, 3);
      expect(chart.invisibleNotes).toHaveLength(1);
      expect(chart.mines).toHaveLength(1);
      expect(chart.mines[0]!.damage).toBe(12.5);
      for (const [layer, path] of [
        ['base', 'base.png'],
        ['layer', 'layer.png'],
        ['poor', 'poor.png'],
      ] as const) {
        const cue = chart.bga[layer].find((cue) => result.chart.resources.bmp[cue.key!] === `s${own}/${path}`);
        expect(cue).toBeDefined();
      }
      expect(result.map.stageRanks.some((change) => change.table === 'bmson' && change.rank === 125)).toBe(true);
      expect(chart.total.unit).toBe(bmsFirst ? 'percent' : 'absolute');
    },
  );

  test('keeps original source-audio offsets under FIT', () => {
    const result = stitchNonstopCourse([{ chart: stageB }, { chart: bmsonStage() }], { connections: ['fade-fit'] });
    if (!result.ok) throw new Error(result.reason);
    expect(result.map.stages[1]!.placement.rate).toBe(1.5);
    const slices = resolveChart(result.chart).sampleTriggers.filter(
      (trigger) => result.chart.resources.wav[trigger.sampleKey] === 'sliced.wav',
    );
    expect(slices.map((trigger) => trigger.sampleOffsetSeconds)).toEqual([0, 0.5, 1, 0]);
  });

  test('does not exhaust the BMS two-character key space in a mixed course', () => {
    const crowded = createEmptyJSON('bms');
    for (let index = 1; index <= 1295; index += 1) {
      const key = index.toString(36).toUpperCase().padStart(2, '0');
      crowded.resources.wav[key] = `${key}.wav`;
      crowded.events.push({ measure: Math.floor(index / 16), position: [index % 16, 16], channel: '01', value: key });
    }
    const result = stitchNonstopCourse(
      [crowded, crowded, crowded, bmsonStage()].map((chart) => ({ chart })),
      { connections: ['blank2', 'blank2', 'blank2'] },
    );
    if (!result.ok) throw new Error(result.reason);
    expect(Object.keys(result.chart.resources.wav).length).toBeGreaterThan(3843);
    const triggers = resolveChart(result.chart).sampleTriggers;
    expect(triggers.filter((trigger) => trigger.samplePath !== undefined).length).toBeGreaterThan(3843);
    expect(triggers.some((trigger) => trigger.sampleKey.length > 2 && trigger.samplePath === 'sliced.wav')).toBe(true);
  });
});

test('mixed NONSTOP keeps native stage judge windows and TOTAL units through replay facts', () => {
  const bmsRanked = bms('#BPM 120', '#RANK 1', '#TOTAL 250', '#00111:01', '#00211:01');
  for (const stages of [
    [bmsRanked, bmsonStage(150)],
    [bmsonStage(150), bmsRanked],
  ]) {
    const result = stitchNonstopCourse(
      stages.map((chart) => ({ chart })),
      { connections: ['blank2'] },
    );
    if (!result.ok) throw new Error(result.reason);
    const stitchedFacts = resolveChartRulesetFacts(result.chart);
    stitchedFacts.judgeRank.stageRanks = result.map.stageRanks.map((change) => ({
      ...change,
      timeUs: Math.round(change.seconds * 1e6),
    }));
    for (const ruleset of ['lr2', 'beatoraja'] as const) {
      const actual = resolveRuleset(stitchedFacts, ruleset);
      for (const [index, stage] of stages.entries()) {
        const expected = resolveRuleset(resolveChartRulesetFacts(stage), ruleset);
        const start = result.map.stageRanks[index]!.seconds;
        expect(actual.windowsAt(Math.round((start + 0.1) * 1e6))).toEqual(expected.windowsAt(0));
      }
      if (stages[1]!.sourceFormat === 'bms') expect(actual.effectiveTotal).toBe(250);
    }
    const roundTrip = parseChart(JSON.stringify(result.chart), 'json');
    expect(roundTrip.bmson.info.totalUnit).toBe(result.chart.bmson.info.totalUnit);
    expect(resolveChart(roundTrip).sampleTriggers.map((trigger) => trigger.sampleOffsetSeconds)).toEqual(
      resolveChart(result.chart).sampleTriggers.map((trigger) => trigger.sampleOffsetSeconds),
    );
  }
});

test('mixed NONSTOP preserves BMS DEFEXRANK as its own stage unit', () => {
  const extended = bms('#BPM 120', '#DEFEXRANK 150', '#00111:01', '#00219:01');
  const result = stitchNonstopCourse([{ chart: bmsonStage() }, { chart: extended }], { connections: ['blank2'] });
  if (!result.ok) throw new Error(result.reason);
  const change = result.map.stageRanks[1]!;
  expect(change).toMatchObject({ rank: 150, table: 'bms-exrank' });
  const facts = resolveChartRulesetFacts(result.chart);
  facts.judgeRank.stageRanks = result.map.stageRanks.map((entry) => ({
    ...entry,
    timeUs: Math.round(entry.seconds * 1e6),
  }));
  for (const ruleset of ['lr2', 'beatoraja'] as const) {
    expect(resolveRuleset(facts, ruleset).windowsAt(Math.round((change.seconds + 0.1) * 1e6))).toEqual(
      resolveRuleset(resolveChartRulesetFacts(extended), ruleset).windowsAt(0),
    );
  }
});

test('mixed bmson output preserves a PMS first stage as nine keys', () => {
  const pms = bms('#BPM 120', '#00111:01', '#00225:01');
  const popn = parseChart(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, mode_hint: 'popn-9k' },
      sound_channels: [{ name: 'key.wav', notes: [{ x: 9, y: 960 }] }],
    }),
    'bmson',
  );
  const result = stitchNonstopCourse([{ chart: pms, pms: true }, { chart: popn }], { connections: ['blank2'] });
  if (!result.ok) throw new Error(result.reason);
  expect(result.chart.bmson.info.modeHint).toBe('popn-9k');
  expect(resolveChart(result.chart).playVariant).toBe('9');
});

test('keeps each NONSTOP stage’s POOR BGA mode', () => {
  const a = structuredClone(stageA),
    b = structuredClone(stageB);
  a.bms.poorBGA = '1';
  b.bms.poorBGA = '2';
  const result = stitchNonstopCourse([{ chart: a }, { chart: b }], { connections: ['cut'] });
  if (!result.ok) throw new Error('stitch failed');
  expect(result.map.stages.map((stage) => stage.poorBGAMode)).toEqual([1, 2]);
});

test('NONSTOP version 2 retains the last declared TOTAL, while version 1 preserves previous replay behavior', () => {
  const first = bms('#BPM 240', '#TOTAL 80', '#00111:01');
  const second = bms('#BPM 240', '#00112:01');
  const build = (stitch: number, tail = second) => {
    const result = stitchNonstopCourse([{ chart: first }, { chart: tail }], { connections: ['blank2'], stitch });
    if (!result.ok) throw new Error(result.reason);
    return result;
  };
  const current = build(2),
    legacy = build(1);
  expect(NONSTOP_STITCH_VERSION).toBe(2);
  expect(current.chart.metadata.total).toBe(80);
  expect(legacy.chart.metadata.total).toBeUndefined();
  expect(resolveChart(current.chart).notes.map((note) => [note.seconds, note.endSeconds])).toEqual(
    resolveChart(legacy.chart).notes.map((note) => [note.seconds, note.endSeconds]),
  );
  expect(build(2, bms('#BPM 240', '#TOTAL 300', '#00112:01')).chart.metadata.total).toBe(300);
  expect(build(2, bms('#BPM 240', '#TOTAL 0', '#00112:01')).chart.metadata.total).toBe(0);
});

test('G.ATTACK NONSTOP damage uses all remaining joined notes and the last declared TOTAL, as HARD does', () => {
  for (const total of [80, 300]) {
    const first = bms('#BPM 240', `#TOTAL ${total}`, `#00111:${'01'.repeat(16)}`);
    const second = bms('#BPM 240', `#00112:${'01'.repeat(16)}`);
    const result = stitchNonstopCourse([{ chart: first }, { chart: second }], { connections: ['blank2'] });
    if (!result.ok) throw new Error(result.reason);
    const facts = resolveChartRulesetFacts(result.chart);
    expect(facts.notes.normal).toBe(32);
    const options = { course: { kind: 'nonstop' as const } };
    const attack = resolveRuleset(facts, 'lr2', { ...options, selectedGauge: 'G-ATTACK' });
    const hard = resolveRuleset(facts, 'lr2', { ...options, selectedGauge: 'HARD' });
    expect(attack.effectiveTotal).toBe(total);
    expect(attack.gauge.values[0]).toBeCloseTo(total === 80 ? -100 : -(7 - 2 / 15) * 10);
    expect(attack.gauge.values[0]).toBe(hard.gauge.values[4]);
    expect(attack.gauge.values[3]).toBe(-6);
  }
});

test('an inherited TOTAL keeps its original unit in a mixed NONSTOP chart', () => {
  const result = stitchNonstopCourse([{ chart: bmsonStage() }, { chart: bms('#BPM 240', '#00111:01') }], {
    connections: ['blank2'],
  });
  if (!result.ok) throw new Error(result.reason);
  expect(resolveChart(result.chart).total).toEqual({ value: 100, unit: 'percent' });
});
