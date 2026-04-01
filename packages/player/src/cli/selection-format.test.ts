import { describe, expect, test } from 'vitest';
import {
  createSelectionColumnLayout,
  formatDifficultyLabel,
  formatPlayLevelLabel,
  formatPlayerLabel,
  formatRankLabel,
  formatSelectionColumnHeader,
  formatSelectionEntryLabel,
  truncateForDisplay,
  type SelectionDisplayEntry,
} from './selection-format.ts';

describe('selection-format', () => {
  test('createSelectionColumnLayout expands columns from chart values and formatted labels', () => {
    const entries: SelectionDisplayEntry[] = [
      {
        kind: 'chart',
        fileLabel: 'alpha.bms',
        player: 3,
        difficulty: 5,
        rankLabel: 'VERY HARD+',
        playLevel: 'NORMAL',
        bpmMin: 120,
        bpmInitial: 150,
        bpmMax: 180,
        totalNotes: 1234,
      },
    ];

    const layout = createSelectionColumnLayout(48, entries);

    expect(layout.playerWidth).toBe('DOUBLE'.length);
    expect(layout.rankWidth).toBe('VERY HARD+'.length);
    expect(layout.playLevelWidth).toBe('PLEVEL'.length);
    expect(layout.notesWidth).toBe('NOTES'.length);
    expect(layout.fileWidth).toBeGreaterThan(0);
  });

  test('formatSelectionColumnHeader and entry labels render placeholders and alignment', () => {
    const layout = createSelectionColumnLayout(60, [
      { kind: 'chart', fileLabel: 'song.bms', player: 1, difficulty: 2, rank: 3, playLevel: 12, bpmMin: 120, bpmInitial: 120, bpmMax: 120, totalNotes: 456 },
    ]);

    expect(formatSelectionColumnHeader(layout)).toContain('PLEVEL');
    expect(formatSelectionEntryLabel({ kind: 'random', label: 'RANDOM SELECT' }, layout)).toContain('-');
    expect(formatSelectionEntryLabel({ kind: 'group', label: 'folder' }, layout)).toBe('folder');
    expect(
      formatSelectionEntryLabel({
        kind: 'chart',
        fileLabel: 'song.bms',
        player: 1,
        difficulty: 2,
        rank: 3,
        playLevel: 12,
        bpmMin: 120,
        bpmInitial: 120,
        bpmMax: 120,
        totalNotes: 456,
      }, layout),
    ).toContain('song.bms');
  });

  test('formatters handle fallback and non-integer values', () => {
    expect(formatPlayerLabel(undefined)).toBe('-');
    expect(formatPlayerLabel(4)).toBe('BATTLE');
    expect(formatPlayerLabel(9)).toBe('9');

    expect(formatDifficultyLabel(undefined)).toBe('-');
    expect(formatDifficultyLabel(6)).toBe('-');
    expect(formatDifficultyLabel(2.9)).toBe('2');

    expect(formatRankLabel(0)).toBe('VERY HARD');
    expect(formatRankLabel(2)).toBe('NORMAL');
    expect(formatRankLabel(2.5)).toBe('2.5');

    expect(formatPlayLevelLabel(undefined)).toBe('-');
    expect(formatPlayLevelLabel('  ANOTHER  ')).toBe('ANOTHER');
    expect(formatPlayLevelLabel(0)).toBe('?');
    expect(formatPlayLevelLabel(12.5)).toBe('12.5');
  });

  test('truncateForDisplay respects full-width, marks, and narrow limits', () => {
    expect(truncateForDisplay('ABCDE', 0)).toBe('');
    expect(truncateForDisplay('ABCDE', 1)).toBe('…');
    expect(truncateForDisplay('ABC', 3)).toBe('ABC');
    expect(truncateForDisplay('こんにちは世界', 5)).toBe('こん…');
    expect(truncateForDisplay('e\u0301abc', 2)).toBe('é…');
  });
});
