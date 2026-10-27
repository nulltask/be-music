import { resolveChart } from '@be-music/chart-model';
import { parseChart } from '@be-music/chart-parser';
import { describe, expect, test } from 'vite-plus/test';
import { preparePlaybackChart } from './bootstrap.ts';
import { createSeekRebuildSink, resetPlayNotes } from './play-seek.ts';
import type { PlayerUIFrameSummary } from './ui-signal-bus.ts';

const SUMMARY: PlayerUIFrameSummary = {
  total: 2,
  perfect: 0,
  fast: 0,
  slow: 0,
  great: 0,
  good: 0,
  bad: 0,
  poor: 0,
  emptyPoor: 0,
  exScore: 0,
  score: 0,
  gauge: { current: 20, max: 100, clearThreshold: 80, initial: 20, effectiveTotal: 160, cleared: false },
};

describe('createSeekRebuildSink', () => {
  test('keeps each judgment with the second it was made at and the gauge and EX score after it, and nothing else', () => {
    const summary = structuredClone(SUMMARY);
    const sink = createSeekRebuildSink(summary);
    sink.emit({ kind: 'gauge', seconds: 0.5, reason: 'judge', judge: 'PERFECT', delta: 1 });
    summary.exScore = 2;
    summary.gauge!.current = 21;
    sink.emit({ kind: 'ui', command: { kind: 'flash-lane', channel: '11' } });
    sink.emit({ kind: 'judge-combo', judge: 'PERFECT', combo: 1, channel: '11' });
    sink.emit({ kind: 'frame', seconds: 0.5 });
    sink.emit({ kind: 'combo', seconds: 0.75, value: 0, reason: 'judge', judge: 'POOR' });
    summary.gauge!.current = 15;
    sink.emit({ kind: 'judge-combo', judge: 'POOR', combo: 0, channel: '12', signedDeltaMs: 120 });
    expect(sink.judgments).toEqual([
      { judge: 'PERFECT', combo: 1, channel: '11', seconds: 0.5, gauge: 21, exScore: 2 },
      { judge: 'POOR', combo: 0, channel: '12', deltaMs: 120, seconds: 0.75, gauge: 15, exScore: 2 },
    ]);
  });
});

describe('resetPlayNotes', () => {
  test("clears every note's judged mark and long-note visibility, and every mine's", () => {
    const chart = parseChart(
      ['#BPM 120', '#LNTYPE 1', '#WAV01 a.wav', '#00013:01', '#00051:0101', '#000D2:01'].join('\n'),
      'bms',
    );
    const prepared = preparePlaybackChart(resolveChart(chart), {}, 0);
    for (const note of [...prepared.notes, ...prepared.invisibleNotes]) {
      note.judged = true;
      note.visibleUntilBeat = 4;
    }
    for (const mine of prepared.landmineNotes) mine.judged = true;
    expect(prepared.notes.length).toBeGreaterThan(1);
    expect(prepared.landmineNotes).toHaveLength(1);
    resetPlayNotes(prepared);
    expect(prepared.notes.every((note) => !note.judged && note.visibleUntilBeat === undefined)).toBe(true);
    expect(prepared.scorableNotes.every((note) => !note.judged)).toBe(true);
    expect(prepared.landmineNotes.every((mine) => !mine.judged)).toBe(true);
  });
});
