import { describe, expect, it } from 'vite-plus/test';
import { JudgeTimingLog, RECENT_JUDGE_TIMING_COUNT } from './judge-timing-log.ts';

describe('JudgeTimingLog', () => {
  it('records timed judgements oldest first, with their channel', () => {
    const log = new JudgeTimingLog();
    expect(log.push(100, 'PERFECT', -3, '11')).toBe(true);
    expect(log.push(200, 'GREAT', 12)).toBe(true);
    expect(log.recent).toEqual([
      { atMs: 100, deltaMs: -3, judge: 'PERFECT', channel: '11' },
      { atMs: 200, deltaMs: 12, judge: 'GREAT' },
    ]);
    expect(log.all).toEqual(log.recent);
    expect(log.lastDeltaMs).toBe(12);
  });

  it('skips judgements without a finite timing or a known grade', () => {
    const log = new JudgeTimingLog();
    expect(log.push(0, 'POOR', undefined)).toBe(false);
    expect(log.push(0, 'BAD', Number.NaN)).toBe(false);
    expect(log.push(0, 'READY', 5)).toBe(false);
    expect(log.all).toEqual([]);
    expect(log.recent).toEqual([]);
    expect(log.lastDeltaMs).toBeUndefined();
  });

  it('keeps only the latest judgements in recent, oldest first, while all keeps every one', () => {
    const log = new JudgeTimingLog(3);
    for (let index = 0; index < 5; index += 1) log.push(index, 'GOOD', index);
    expect(log.recent.map((timing) => timing.deltaMs)).toEqual([2, 3, 4]);
    log.push(5, 'GOOD', 5);
    expect(log.recent.map((timing) => timing.deltaMs)).toEqual([3, 4, 5]);
    expect(log.all.map((timing) => timing.deltaMs)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('defaults to the documented 64 recent judgements', () => {
    const log = new JudgeTimingLog();
    for (let index = 0; index < 100; index += 1) log.push(index, 'PERFECT', index);
    expect(RECENT_JUDGE_TIMING_COUNT).toBe(64);
    expect(log.recent).toHaveLength(64);
    expect(log.recent[0]!.deltaMs).toBe(36);
    expect(log.recent.at(-1)!.deltaMs).toBe(99);
  });

  it('hands back the same recent array between judgements', () => {
    const log = new JudgeTimingLog(2);
    log.push(0, 'PERFECT', 1);
    const first = log.recent;
    expect(log.recent).toBe(first);
    log.push(1, 'PERFECT', 2);
    expect(log.recent).toBe(first);
  });

  it('starts a fresh all list on clear, leaving the previous one intact', () => {
    const log = new JudgeTimingLog();
    log.push(0, 'PERFECT', 1);
    const previous = log.all;
    log.clear();
    expect(previous).toHaveLength(1);
    expect(log.all).toEqual([]);
    expect(log.recent).toEqual([]);
    expect(log.lastDeltaMs).toBeUndefined();
    log.push(1, 'GREAT', -4);
    expect(log.recent).toEqual([{ atMs: 1, deltaMs: -4, judge: 'GREAT' }]);
  });
});
