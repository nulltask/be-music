import { describe, expect, test } from 'vitest';
import type { BeMusicPlaylog, PlaylogRulesetResult } from '@be-music/player/playlog';
import { buildPlaylogReport, parsePlaylogCliArgs } from './playlog-cli.ts';

function makePlaylog(): BeMusicPlaylog {
  return {
    format: 'be-music-playlog',
    version: 1,
    createdAt: '2026-08-17T10:00:00.000Z',
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      title: 'Sample Song',
      artist: 'someone',
      sourceFormat: 'bms',
      laneMode: '7keys',
      total: 300,
      lnMode: 1,
      judgeRank: { percent: 75, sourceRank: 2 },
      noteCount: 10,
      notes: [],
    },
    inputs: [],
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE' },
  };
}

function makeResult(overrides: Partial<PlaylogRulesetResult> = {}): PlaylogRulesetResult {
  return {
    ruleset: 'lr2/1',
    judge: { pgreat: 8, great: 1, good: 0, bad: 1, poor: 0, emptyPoor: 2 },
    fast: 1,
    slow: 0,
    exScore: 17,
    noteCount: 10,
    maxCombo: 9,
    score: 170000,
    djLevel: 'AA',
    gauge: { type: 'GROOVE', final: 84, cleared: true },
    ...overrides,
  };
}

describe('playlog-cli', () => {
  test('parsePlaylogCliArgs: defaults to all rulesets and collects files', () => {
    const args = parsePlaylogCliArgs(['a.bmplay.json', 'b.bmplay.json']);
    expect(args.files).toEqual(['a.bmplay.json', 'b.bmplay.json']);
    expect(args.rulesets).toEqual(['lr2', 'beatoraja', 'iidx']);
    expect(args.json).toBe(false);
    expect(args.help).toBe(false);
    expect(args.gauge).toBeUndefined();
    expect(args.judgeAlgorithm).toBeUndefined();
  });

  test('parsePlaylogCliArgs: parses ruleset list, gauge, algorithm, and flags', () => {
    const args = parsePlaylogCliArgs([
      '--ruleset=lr2,iidx',
      '--gauge=hard',
      '--algorithm=lowest',
      '--json',
      'file.bmplay.json',
    ]);
    expect(args.rulesets).toEqual(['lr2', 'iidx']);
    expect(args.gauge).toBe('HARD');
    expect(args.judgeAlgorithm).toBe('lowest');
    expect(args.json).toBe(true);
    expect(args.files).toEqual(['file.bmplay.json']);
  });

  test('parsePlaylogCliArgs: --ruleset=all restores every simulator', () => {
    expect(parsePlaylogCliArgs(['--ruleset=all']).rulesets).toEqual(['lr2', 'beatoraja', 'iidx']);
  });

  test('parsePlaylogCliArgs: rejects unknown rulesets, algorithms, and options', () => {
    expect(() => parsePlaylogCliArgs(['--ruleset=osu'])).toThrow(/unknown ruleset 'osu'/);
    expect(() => parsePlaylogCliArgs(['--algorithm=psychic'])).toThrow(/unknown judge algorithm/);
    expect(() => parsePlaylogCliArgs(['--frobnicate'])).toThrow(/unknown option '--frobnicate'/);
  });

  test('parsePlaylogCliArgs: --help and -h set the help flag', () => {
    expect(parsePlaylogCliArgs(['--help']).help).toBe(true);
    expect(parsePlaylogCliArgs(['-h']).help).toBe(true);
  });

  test('buildPlaylogReport: renders the chart header and one row per result', () => {
    const report = buildPlaylogReport('file.bmplay.json', makePlaylog(), [
      { label: 'lr2/1', result: makeResult() },
      {
        label: 'iidx/1',
        result: makeResult({
          ruleset: 'iidx/1',
          score: undefined,
          djLevel: 'A',
          gauge: { type: 'HARD', final: 0, cleared: false, failedMidPlay: true },
        }),
      },
    ]);
    expect(report).toContain('=== file.bmplay.json');
    expect(report).toContain('Sample Song / someone [7keys] notes=10 mode=manual gauge=GROOVE');
    expect(report).toContain('@ 2026-08-17T10:00:00.000Z');
    const lines = report.split('\n');
    const lr2Line = lines.find((line) => line.startsWith('lr2/1'));
    expect(lr2Line).toBeDefined();
    // EX 17 / 10 notes → 85.00%, money score printed, gauge cleared.
    expect(lr2Line).toContain('17');
    expect(lr2Line).toContain('85.00%');
    expect(lr2Line).toContain('170000');
    expect(lr2Line).toContain('84.0% GROOVE CLEAR');
    const iidxLine = lines.find((line) => line.startsWith('iidx/1'));
    expect(iidxLine).toContain('0.0% HARD FAILED(0%)');
    // No money score for IIDX.
    expect(iidxLine).toContain(' - ');
  });

  test('buildPlaylogReport: marks aborted plays and auto scratch in the header', () => {
    const playlog = makePlaylog();
    playlog.play.autoScratch = true;
    playlog.play.aborted = true;
    const report = buildPlaylogReport('x', playlog, []);
    expect(report).toContain('mode=manual+autoscratch');
    expect(report).toContain('(aborted)');
  });
});
