import { describe, expect, it } from 'vite-plus/test';
import { selectListRows } from './select-list.ts';

const entries = Array.from({ length: 20 }, (_, index) => index);

describe('selectListRows', () => {
  it('is exactly the window at rest', () => {
    expect(selectListRows({ entries, firstVisibleIndex: 5, visibleRows: 3, listScroll: 0 }, 30)).toEqual([
      { entryIndex: 5, slot: 0, alpha: 1 },
      { entryIndex: 6, slot: 1, alpha: 1 },
      { entryIndex: 7, slot: 2, alpha: 1 },
    ]);
    expect(selectListRows({ entries, firstVisibleIndex: 5, visibleRows: 3 }, 30)).toHaveLength(3);
  });

  it('moves the rows up and slides the next one in while pulled toward later entries', () => {
    expect(selectListRows({ entries, firstVisibleIndex: 5, visibleRows: 3, listScroll: 15 }, 30)).toEqual([
      { entryIndex: 5, slot: -0.5, alpha: 0.5 },
      { entryIndex: 6, slot: 0.5, alpha: 1 },
      { entryIndex: 7, slot: 1.5, alpha: 1 },
      { entryIndex: 8, slot: 2.5, alpha: 0.5 },
    ]);
  });

  it('moves the rows down and slides the previous one in while pulled toward earlier entries', () => {
    const rows = selectListRows({ entries, firstVisibleIndex: 5, visibleRows: 3, listScroll: -6 }, 30);
    expect(rows.map((row) => row.entryIndex)).toEqual([4, 5, 6, 7]);
    expect(rows[0]!.slot).toBeCloseTo(-0.8);
    expect(rows[0]!.alpha).toBeCloseTo(0.2);
    expect(rows[3]!.alpha).toBeCloseTo(0.8);
  });

  it('leaves out rows past either end of the list', () => {
    expect(
      selectListRows({ entries, firstVisibleIndex: 0, visibleRows: 3, listScroll: -10 }, 30).map((r) => r.entryIndex),
    ).toEqual([0, 1, 2]);
    expect(
      selectListRows({ entries: [0, 1], firstVisibleIndex: 0, visibleRows: 3, listScroll: 0 }, 30).map(
        (r) => r.entryIndex,
      ),
    ).toEqual([0, 1]);
  });

  it('holds the pull under one row', () => {
    const rows = selectListRows({ entries, firstVisibleIndex: 5, visibleRows: 3, listScroll: 90 }, 30);
    expect(rows[0]).toEqual({ entryIndex: 6, slot: 0, alpha: 1 });
  });
});
