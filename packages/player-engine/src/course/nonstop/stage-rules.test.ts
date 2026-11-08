import { keysOutBGALayerBlack, resolveChart, usesMonophonicWAVPlayback } from '@be-music/chart-model';
import { parseChart } from '@be-music/chart-parser';
import { describe, expect, test } from 'vite-plus/test';
import { resolveChartRulesetFacts } from '../../core/play-chart.ts';
import { resolveRuleset } from '../../ruleset/index.ts';
import { stitchNonstopCourse, type StitchNonstopOptions } from './compose.ts';

const bms = (...lines: string[]) => parseChart(lines.join('\n'), 'bms');

/** 240 BPM (a measure a second), keysounds on lane 1 at measures 1-3 and a BGA layer image. */
const plain = (...extra: string[]) =>
  bms('#BPM 240', '#WAV01 a.wav', '#BMP01 a.bmp', '#00107:01', '#00111:01', '#00211:01', '#00311:01', ...extra);

function stitch(charts: ReturnType<typeof bms>[], options: Partial<StitchNonstopOptions> = {}) {
  const result = stitchNonstopCourse(
    charts.map((chart) => ({ chart })),
    { connections: charts.slice(1).map(() => 'cut' as const), ...options },
  );
  if (!result.ok) throw new Error(`stitch failed: ${result.reason}`);
  return result;
}

describe('NONSTOP stitching keeps each stage’s own rules (rule version 4)', () => {
  // A CN on a BMS stage makes the output bmson.
  const charge = () => plain('#LNTYPE 1', '#LNMODE 2', '#00452:0101');

  test('a BMS stage in bmson output keeps monophonic slots and keyed-out layer black', () => {
    const { chart, map } = stitch([charge(), plain()]);
    expect(chart.sourceFormat).toBe('bmson');
    for (const stage of map.stages) {
      for (const key of stage.wavKeys) expect(usesMonophonicWAVPlayback(chart, key)).toBe(true);
      for (const key of stage.bmpKeys) expect(keysOutBGALayerBlack(chart, key)).toBe(true);
    }
  });

  test('rule version 3 leaves bmson output polyphonic', () => {
    const { chart, map } = stitch([charge(), plain()], { stitch: 3 });
    expect(chart.resources.wavSourceFormat).toBeUndefined();
    expect(chart.resources.bmpSourceFormat).toBeUndefined();
    expect(usesMonophonicWAVPlayback(chart, map.stages[0]!.wavKeys[0])).toBe(false);
  });

  test('BMS output keeps the slot table empty: the chart format already says BMS', () => {
    const { chart } = stitch([plain(), plain()]);
    expect(chart.sourceFormat).toBe('bms');
    expect(chart.resources.wavSourceFormat).toBeUndefined();
  });

  test('#DEFEXRANK carries into BMS output, the first stage as the chart’s and later ones as stage ranks', () => {
    const { chart, map } = stitch([plain('#DEFEXRANK 120'), plain('#DEFEXRANK 80')]);
    expect(chart.bms.defExRank).toBe(120);
    expect(map.stageRanks).toEqual([expect.objectContaining({ rank: 80, table: 'bms-exrank' })]);
    const legacy = stitch([plain('#DEFEXRANK 120'), plain('#DEFEXRANK 80')], { stitch: 3 });
    expect(legacy.chart.bms.defExRank).toBeUndefined();
    expect(legacy.map.stageRanks).toEqual([expect.objectContaining({ rank: 2, table: 'chart' })]);
  });

  test('#EXRANKxx changes follow their stage, after its own rank switch', () => {
    const { map } = stitch([plain('#EXRANK01 50', '#002A0:01'), plain('#RANK 3', '#EXRANK01 30', '#001A0:01')]);
    const [stageRank, ...rest] = map.stageRanks.filter((change) => change.table !== 'bms-exrank-change');
    expect(rest).toEqual([]);
    const changes = map.stageRanks.filter((change) => change.table === 'bms-exrank-change');
    expect(changes.map((change) => change.rank)).toEqual([50, 30]);
    expect(changes[0]!.seconds).toBeCloseTo(2);
    // The second stage's change at its measure 1 lies before the stage switch, so it moves there and wins.
    expect(changes[1]!.seconds).toBe(stageRank!.seconds);
    expect(map.stageRanks.indexOf(changes[1]!)).toBeGreaterThan(map.stageRanks.indexOf(stageRank!));
    expect(stitch([plain('#EXRANK01 50', '#002A0:01')], { stitch: 3 }).map.stageRanks).toEqual([]);
  });

  test('LR2 judges with a stage’s #EXRANKxx change as it would the chart alone; beatoraja ignores it', () => {
    const changing = plain('#EXRANK01 50', '#002A0:01');
    const { chart, map } = stitch([charge(), changing]);
    expect(chart.sourceFormat).toBe('bmson');
    const facts = resolveChartRulesetFacts(chart);
    facts.judgeRank.stageRanks = map.stageRanks.map((entry) => ({ ...entry, timeUs: Math.round(entry.seconds * 1e6) }));
    const change = map.stageRanks.find((entry) => entry.table === 'bms-exrank-change')!;
    const at = Math.round((change.seconds + 0.01) * 1e6);
    // `#EXRANKxx 50` judges as `#DEFEXRANK 50` does.
    const windows = (chart: ReturnType<typeof bms>, ruleset: 'lr2' | 'beatoraja') =>
      resolveRuleset(resolveChartRulesetFacts(chart), ruleset).windowsAt(0);
    expect(resolveRuleset(facts, 'lr2').windowsAt(at)).toEqual(windows(plain('#DEFEXRANK 50'), 'lr2'));
    expect(windows(plain('#DEFEXRANK 50'), 'lr2')).not.toEqual(windows(changing, 'lr2'));
    expect(resolveRuleset(facts, 'beatoraja').windowsAt(at)).toEqual(windows(changing, 'beatoraja'));
  });

  test('97 / 98 volume changes stay with their stage: a later stage starts at full volume', () => {
    const { chart, map } = stitch([plain('#00297:40', '#00298:80'), plain()]);
    const changes = resolveChart(chart).volumeChanges.map((change) => [change.bus, change.gain] as const);
    expect(changes).toEqual([
      ['bgm', 0x40 / 0xff],
      ['play', 0x80 / 0xff],
      ['bgm', 1],
      ['play', 1],
    ]);
    const resets = resolveChart(chart).volumeChanges.slice(2);
    for (const reset of resets) expect(reset.seconds).toBeCloseTo(map.stages[1]!.windowStart, 3);
    expect(resolveChart(stitch([plain('#00297:40'), plain()], { stitch: 3 }).chart).volumeChanges).toEqual([]);
  });

  test('volume changes survive bmson output', () => {
    const { chart } = stitch([charge(), plain('#00297:40')]);
    expect(chart.sourceFormat).toBe('bmson');
    expect(resolveChart(chart).volumeChanges.map((change) => change.gain)).toEqual([0x40 / 0xff]);
  });

  test('SCROLL and SPEED stay with their stage: a later stage starts at 1', () => {
    const { chart, map } = stitch([plain('#SCROLL01 0.5', '#SPEED01 2', '#002SC:01', '#002SP:01'), plain()]);
    const resolved = resolveChart(chart);
    const start = map.stages[1]!.windowStart;
    const at = (beat: number) => resolved.timing.beatToSeconds(beat);
    expect(resolved.scroll.map((point) => [at(point.beat), point.speed])).toEqual([
      [expect.closeTo(2, 3), 0.5],
      [expect.closeTo(start, 3), 1],
    ]);
    expect(resolved.speed.map((point) => [at(point.beat), point.speed])).toEqual([
      [expect.closeTo(2, 3), 2],
      [expect.closeTo(start - 0.001, 3), 2],
      [expect.closeTo(start, 3), 1],
    ]);
    const legacy = resolveChart(stitch([plain('#SCROLL01 0.5', '#002SC:01'), plain()], { stitch: 3 }).chart);
    expect(legacy.scroll).toEqual([]);
  });

  test('SCROLL survives bmson output', () => {
    const { chart } = stitch([charge(), plain('#SCROLL01 -1', '#002SC:01')]);
    expect(chart.sourceFormat).toBe('bmson');
    expect(resolveChart(chart).scroll.map((point) => point.speed)).toEqual([-1]);
  });

  test('each stage’s mines explode with its own #WAV00', () => {
    const { chart, map } = stitch([plain('#WAV00 boom.wav', '#002D2:0A'), plain('#002D2:0A')]);
    const [first, second] = map.landmineSampleKeys!;
    expect(first).toEqual({ seconds: 0, sampleKey: expect.any(String) });
    expect(chart.resources.wav[first!.sampleKey!]).toBe('boom.wav');
    expect(map.stages[0]!.wavKeys).toContain(first!.sampleKey);
    expect(second).toEqual({ seconds: map.stages[1]!.windowStart });
    expect(stitch([plain(), plain()]).map.landmineSampleKeys).toBeUndefined();
    expect(stitch([plain('#WAV00 boom.wav')], { stitch: 3 }).map.landmineSampleKeys).toBeUndefined();
  });

  describe('negative-BPM reversal', () => {
    // The reversal sits at measure 2.5 of the first stage, inside its window.
    const reversing = () => plain('#BPM01 -240', '#00208:0001');

    test('freezes the rest of the stitched play from where it falls, as LR2 does', () => {
      const { chart } = stitch([reversing(), plain()]);
      const resolved = resolveChart(chart);
      expect(resolved.reversal?.seconds).toBeCloseTo(2.5, 3);
      // The scroll keeps its 150 BPM.
      expect(resolved.timing.tempoPoints.map((point) => point.bpm)).toEqual([150, 150]);
    });

    test('a reversal past the stage window is dropped, as LR2 drops BPM changes from the last measure line on', () => {
      const late = plain('#BPM01 -240', '#00608:01');
      expect(resolveChart(stitch([late, plain()]).chart).reversal).toBeUndefined();
      // The last stage's window never ends.
      expect(resolveChart(stitch([plain(), late]).chart).reversal).toBeDefined();
    });

    test('rule version 3 stitches past it', () => {
      expect(resolveChart(stitch([reversing(), plain()], { stitch: 3 }).chart).reversal).toBeUndefined();
    });
  });
});
