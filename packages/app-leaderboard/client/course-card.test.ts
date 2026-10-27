import { describe, expect, test } from 'vite-plus/test';
import { safeAreaViolation } from '../src/pages/share-card-safe-area.ts';
import { STAGE_FRAME, STAGE_LIST_BOX, STAGE_ROW_MAX, STAGE_ROW_MIN, stageAccent, stageRows } from './course-card.ts';
import { PANEL_LEFT, SCORE_CARD_BOXES } from './score-card.ts';

describe('course card layout', () => {
  test('the stage list stays inside the safe area, below the site name and on the panel', () => {
    expect(safeAreaViolation(STAGE_LIST_BOX)).toBeNull();
    expect(STAGE_LIST_BOX.y).toBeGreaterThanOrEqual(SCORE_CARD_BOXES.siteName.y + SCORE_CARD_BOXES.siteName.height);
    expect(STAGE_LIST_BOX.x).toBeGreaterThan(PANEL_LEFT);
    // Clear of the counts row's judge line and glow below it, and of the left column.
    expect(STAGE_LIST_BOX.x).toBeGreaterThan(SCORE_CARD_BOXES.counts.x + SCORE_CARD_BOXES.counts.width);
  });

  test('a grade course of four stages lists them all at the tallest row height', () => {
    const { rows, shown, more } = stageRows(4);
    expect(shown).toBe(4);
    expect(more).toBe(0);
    expect(rows.map((row) => row.height)).toEqual([STAGE_ROW_MAX, STAGE_ROW_MAX, STAGE_ROW_MAX, STAGE_ROW_MAX]);
    expect(rows[0]?.y).toBe(STAGE_FRAME.top);
  });

  test.each([1, 2, 3, 4, 5, 6, 10, 30])('%i stages: rows stay in the frame, never shorter than two lines', (count) => {
    const { rows, shown, more } = stageRows(count);
    expect(shown + more).toBe(count);
    expect(rows.length).toBe(more > 0 ? shown + 1 : shown);
    for (const row of rows) {
      expect(row.height).toBeGreaterThanOrEqual(STAGE_ROW_MIN);
      expect(row.height).toBeLessThanOrEqual(STAGE_ROW_MAX);
      expect(row.y + row.height).toBeLessThanOrEqual(STAGE_FRAME.bottom);
      expect(safeAreaViolation(row)).toBeNull();
    }
    // Rows sit edge to edge.
    rows.slice(1).forEach((row, i) => expect(row.y).toBe((rows[i]?.y ?? 0) + (rows[i]?.height ?? 0)));
  });

  test('more stages than fit end in a row that counts the rest', () => {
    const { rows, shown, more } = stageRows(10);
    expect(rows).toHaveLength(Math.floor((STAGE_FRAME.bottom - STAGE_FRAME.top) / STAGE_ROW_MIN));
    expect(shown).toBe(rows.length - 1);
    expect(more).toBe(10 - shown);
  });

  test('no stages, no rows', () => {
    expect(stageRows(0)).toEqual({ rows: [], shown: 0, more: 0 });
  });

  test('a cleared stage is light, a failed one red, and the rest dim, apart from one another', () => {
    expect(stageAccent('failed')).toBe('#ff4d5e');
    const states = ['cleared', 'failed', 'played', 'unreached'] as const;
    expect(new Set(states.map(stageAccent)).size).toBe(states.length);
  });
});
