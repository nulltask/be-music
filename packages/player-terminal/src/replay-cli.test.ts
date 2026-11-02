import { describe, expect, test } from 'vite-plus/test';
import type { BeMusicReplay, ReplayRulesetResult } from '@be-music/player-engine/replay';
import { buildReplayReport, parseReplayCLIArgs } from './replay-cli.ts';

function makeReplay(): BeMusicReplay {
  return {
    format: 'be-music-replay',
    version: 0,
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

function makeResult(overrides: Partial<ReplayRulesetResult> = {}): ReplayRulesetResult {
  return {
    ruleset: 'lr2/0',
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

describe('replay-cli', () => {
  test('parseReplayCLIArgs: defaults to all rulesets and collects files', () => {
    const args = parseReplayCLIArgs(['a.bmplay.json', 'b.bmplay.json']);
    expect(args.files).toEqual(['a.bmplay.json', 'b.bmplay.json']);
    expect(args.rulesets).toEqual(['lr2', 'beatoraja', '____']);
    expect(args.json).toBe(false);
    expect(args.help).toBe(false);
    expect(args.gauge).toBeUndefined();
    expect(args.judgeAlgorithm).toBeUndefined();
  });

  test('parseReplayCLIArgs: parses ruleset list, gauge, algorithm, and flags', () => {
    const args = parseReplayCLIArgs([
      '--ruleset=lr2,____',
      '--gauge=hard',
      '--algorithm=lowest',
      '--json',
      'file.bmplay.json',
    ]);
    expect(args.rulesets).toEqual(['lr2', '____']);
    expect(args.gauge).toBe('HARD');
    expect(args.judgeAlgorithm).toBe('lowest');
    expect(args.json).toBe(true);
    expect(args.files).toEqual(['file.bmplay.json']);
  });

  test('parseReplayCLIArgs: --ruleset=all restores every simulator', () => {
    expect(parseReplayCLIArgs(['--ruleset=all']).rulesets).toEqual(['lr2', 'beatoraja', '____']);
  });

  test('parseReplayCLIArgs: rejects unknown rulesets, algorithms, and options', () => {
    expect(() => parseReplayCLIArgs(['--ruleset=osu'])).toThrow(/unknown ruleset 'osu'/);
    expect(() => parseReplayCLIArgs(['--algorithm=psychic'])).toThrow(/unknown judge algorithm/);
    expect(() => parseReplayCLIArgs(['--frobnicate'])).toThrow(/unknown option '--frobnicate'/);
  });

  test('parseReplayCLIArgs: `--` ends the options and everything after it is a file', () => {
    expect(parseReplayCLIArgs(['--', 'a.bmplay.json']).files).toEqual(['a.bmplay.json']);

    const args = parseReplayCLIArgs(['--json', '--', '--weird.bmplay.json', '--', 'b.bmplay.json']);
    expect(args.json).toBe(true);
    expect(args.files).toEqual(['--weird.bmplay.json', '--', 'b.bmplay.json']);
  });

  test('parseReplayCLIArgs: --help and -h set the help flag', () => {
    expect(parseReplayCLIArgs(['--help']).help).toBe(true);
    expect(parseReplayCLIArgs(['-h']).help).toBe(true);
  });

  test('buildReplayReport: renders the chart header and one row per result', () => {
    const report = buildReplayReport('file.bmplay.json', makeReplay(), [
      { label: 'lr2/0', result: makeResult() },
      {
        label: '____/0',
        result: makeResult({
          ruleset: '____/0',
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
    const lr2Line = lines.find((line) => line.startsWith('lr2/0'));
    expect(lr2Line).toBeDefined();
    // EX 17 / 10 notes → 85.00%, money score printed, gauge cleared.
    expect(lr2Line).toContain('17');
    expect(lr2Line).toContain('85.00%');
    expect(lr2Line).toContain('170000');
    expect(lr2Line).toContain('84.0% GROOVE CLEAR');
    const ____Line = lines.find((line) => line.startsWith('????/0'));
    expect(____Line).toContain('0.0% HARD FAILED(0%)');
    // No money score for That-Which-Must-Not-Be-Named.
    expect(____Line).toContain(' - ');
  });

  test('buildReplayReport: marks truncated results and rulesets the replay is not simulated under', () => {
    const report = buildReplayReport('file.bmplay.json', makeReplay(), [
      { label: 'lr2/0', result: makeResult(), outcome: 'truncated' },
      { label: 'beatoraja', note: 'gauge' },
    ]);
    const lines = report.split('\n');
    expect(lines.find((line) => line.startsWith('lr2/0'))).toContain('84.0% GROOVE CLEAR TRUNCATED');
    expect(lines.find((line) => line.startsWith('beatoraja'))).toMatch(/^beatoraja\s+not simulated \(gauge\)$/);
  });

  test('buildReplayReport: marks aborted plays and auto scratch in the header', () => {
    const replay = makeReplay();
    replay.play.autoScratch = true;
    replay.play.aborted = true;
    const report = buildReplayReport('x', replay, []);
    expect(report).toContain('mode=manual+autoscratch');
    expect(report).toContain('(aborted)');
  });
});
