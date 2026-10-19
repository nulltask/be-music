import { describe, expect, test } from 'vite-plus/test';
import { SPLIT_PANEL_INNER_WIDTH } from './layout.ts';
import {
  colorizeLaneOuterBorder,
  hasLaneSplit,
  LANE_FILL_SYMBOL,
  MEASURE_LINE_SYMBOL,
  NOTE_HEAD_SYMBOL,
  renderInputKeyRows,
  renderJudgeComboLine,
  renderJudgeRow,
  renderLaneRow,
  renderMeasureRow,
  setLaneCell,
} from './lane-rows.ts';

function stripANSI(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replaceAll(/\u001b\[[0-9;]*m/g, '');
}

const SPLIT_PANEL = `┃${' '.repeat(SPLIT_PANEL_INNER_WIDTH)}┃`;

describe('hasLaneSplit', () => {
  test('is true only for a split index inside the lanes', () => {
    expect(hasLaneSplit(3, 8)).toBe(true);
    expect(hasLaneSplit(7, 8)).toBe(false);
    expect(hasLaneSplit(-1, 8)).toBe(false);
    expect(hasLaneSplit(undefined, 8)).toBe(false);
    expect(hasLaneSplit(1.5, 8)).toBe(false);
  });
});

describe('colorizeLaneOuterBorder', () => {
  test('draws the border in the lane border colour', () => {
    expect(colorizeLaneOuterBorder('┃')).toBe('\u001b[38;2;218;218;218m┃\u001b[0m');
  });
});

describe('renderLaneRow', () => {
  test('draws empty lanes and notes between the lane borders', () => {
    expect(stripANSI(renderLaneRow([LANE_FILL_SYMBOL, NOTE_HEAD_SYMBOL], ['11', '12'], [3, 3], -1, 8))).toBe(
      '┃   │███┃',
    );
    expect(stripANSI(renderLaneRow([NOTE_HEAD_SYMBOL], ['11'], [2], -1, 1))).toBe('┃▁▁┃');
  });

  test('puts the split panel between the two sides', () => {
    expect(stripANSI(renderLaneRow([LANE_FILL_SYMBOL, NOTE_HEAD_SYMBOL], ['11', '21'], [3, 3], 0, 8))).toBe(
      `┃   ┃${SPLIT_PANEL}┃███┃`,
    );
  });

  test('colours a scratch note red and lights a pressed lane', () => {
    expect(renderLaneRow([NOTE_HEAD_SYMBOL], ['16'], [3], -1, 8)).toContain('\u001b[38;2;255;95;95;4m');
    const plain = renderLaneRow([LANE_FILL_SYMBOL], ['11'], [3]);
    const lit = renderLaneRow([LANE_FILL_SYMBOL], ['11'], [3], -1, 8, new Map([[0, 1]]));
    expect(plain).toContain('\u001b[48;2;24;36;56m');
    expect(lit).toContain('\u001b[48;2;80;98;130m');
  });
});

describe('renderJudgeRow', () => {
  test('draws the judge line across the lanes in the note height', () => {
    expect(stripANSI(renderJudgeRow([LANE_FILL_SYMBOL, LANE_FILL_SYMBOL], ['11', '12'], [2, 2], -1, 8))).toBe(
      '┃█████┃',
    );
    expect(stripANSI(renderJudgeRow([LANE_FILL_SYMBOL, NOTE_HEAD_SYMBOL], ['11', '12'], [2, 2], -1, 1))).toBe(
      '┃▁▁▁▁▁┃',
    );
  });
});

describe('renderMeasureRow', () => {
  test('draws the measure line, keeping notes on it', () => {
    expect(stripANSI(renderMeasureRow([LANE_FILL_SYMBOL, LANE_FILL_SYMBOL], ['11', '12'], [2, 2]))).toBe(
      `┃${MEASURE_LINE_SYMBOL.repeat(2)}┬${MEASURE_LINE_SYMBOL.repeat(2)}┃`,
    );
    expect(stripANSI(renderMeasureRow([LANE_FILL_SYMBOL, NOTE_HEAD_SYMBOL], ['11', '12'], [2, 2], -1, 8))).toBe(
      `┃${MEASURE_LINE_SYMBOL.repeat(2)}┬██┃`,
    );
  });
});

describe('renderJudgeComboLine', () => {
  test('centers the label over the lanes', () => {
    expect(renderJudgeComboLine({ single: 'GO', left: 'L', right: 'R' }, [3, 3], undefined)).toBe('   GO    ');
  });

  test('centers each side over its lanes when they are split', () => {
    expect(renderJudgeComboLine({ single: 'GO', left: 'L', right: 'R' }, [3, 3], 0)).toBe(
      `  L  ${' '.repeat(SPLIT_PANEL_INNER_WIDTH + 2)}  R  `,
    );
  });
});

describe('renderInputKeyRows', () => {
  const lanes = [
    { channel: '16', key: 'A', isScratch: true },
    { channel: '11', key: 'Z' },
    { channel: '12', key: 'S' },
  ];

  test('puts the black keys on the upper row and the white keys and scratch on the lower row', () => {
    const [upper, lower] = renderInputKeyRows(lanes, [3, 3, 3]);
    expect(stripANSI(upper)).toBe('┃   │   │ S ┃');
    expect(stripANSI(lower)).toBe('┃ A │ Z │   ┃');
  });

  test('can split the keys by odd and even lane numbers', () => {
    const [upper, lower] = renderInputKeyRows(lanes, [3, 3, 3], -1, new Set(), true);
    expect(stripANSI(upper)).toBe('┃ A │   │ S ┃');
    expect(stripANSI(lower)).toBe('┃   │ Z │   ┃');
  });

  test('lights a pressed key', () => {
    const [, lower] = renderInputKeyRows(lanes, [3, 3, 3], -1, new Set(['11']));
    expect(lower).toContain('\u001b[38;2;24;24;24;48;2;255;135;0m Z ');
  });
});

describe('setLaneCell', () => {
  function createGrid(rows: number, lanes: number) {
    return {
      grid: Array.from({ length: rows }, () => Array.from({ length: lanes }, () => LANE_FILL_SYMBOL)),
      sources: Array.from({ length: rows }, () => Array.from({ length: lanes }, () => '')),
    };
  }

  test('places a symbol and records its channel', () => {
    const { grid, sources } = createGrid(4, 2);
    expect(setLaneCell(grid, sources, 2, 0, NOTE_HEAD_SYMBOL, '11', new Set())).toBe(2);
    expect(grid[2]![0]).toBe(NOTE_HEAD_SYMBOL);
    expect(sources[2]![0]).toBe('11');
  });

  test('clamps the row into the grid', () => {
    const { grid, sources } = createGrid(4, 2);
    expect(setLaneCell(grid, sources, 10, 1, NOTE_HEAD_SYMBOL, '12', new Set())).toBe(3);
    expect(grid[3]![1]).toBe(NOTE_HEAD_SYMBOL);
  });

  test('keeps a higher-priority symbol', () => {
    const { grid, sources } = createGrid(4, 2);
    setLaneCell(grid, sources, 2, 0, NOTE_HEAD_SYMBOL, '11', new Set());
    setLaneCell(grid, sources, 2, 0, MEASURE_LINE_SYMBOL, '01', new Set());
    expect(grid[2]![0]).toBe(NOTE_HEAD_SYMBOL);
    setLaneCell(grid, sources, 2, 0, NOTE_HEAD_SYMBOL, '17', new Set(['17']));
    expect(sources[2]![0]).toBe('11');
  });

  test('stacks an overlapping note away from the judge line', () => {
    const { grid, sources } = createGrid(4, 2);
    setLaneCell(grid, sources, 2, 0, NOTE_HEAD_SYMBOL, '11', new Set(), true);
    expect(setLaneCell(grid, sources, 2, 0, NOTE_HEAD_SYMBOL, '11', new Set(), true)).toBe(1);
    expect(grid[1]![0]).toBe(NOTE_HEAD_SYMBOL);
  });
});
