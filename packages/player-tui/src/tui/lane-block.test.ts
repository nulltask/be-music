import { describe, expect, test } from 'vite-plus/test';
import { ANSI_RESET } from './ansi-text.ts';
import {
  renderLaneBlockWithBga,
  renderLaneBlockWithKittyPadding,
  renderLaneLinesWithProgressIndicators,
  resolveGrooveGaugeLeftPadding,
} from './lane-block.ts';

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replaceAll(/\u001b\[[0-9;]*m/g, '');
}

const BLACK_CELLS = `\u001b[48;2;0;0;0m  ${ANSI_RESET}`;

describe('resolveGrooveGaugeLeftPadding', () => {
  test('lines the gauge up with the lanes past the progress indicator', () => {
    expect(resolveGrooveGaugeLeftPadding(8)).toBe(1);
    expect(resolveGrooveGaugeLeftPadding(0)).toBe(0);
  });
});

describe('renderLaneLinesWithProgressIndicators', () => {
  test('draws the indicator beside the lane rows, lit at the play position', () => {
    const lines = renderLaneLinesWithProgressIndicators(['a', 'b', 'c'], 0, 10, 0, 2, false);
    expect(lines.map(stripAnsi)).toEqual(['┃a', '┃b', '┃c']);
    expect(lines[0]).toContain('\u001b[38;2;255;186;54m');
    expect(lines[1]).toContain('\u001b[38;2;18;18;18m');
    const ended = renderLaneLinesWithProgressIndicators(['a', 'b', 'c'], 10, 10, 0, 2, false);
    expect(ended[2]).toContain('\u001b[38;2;255;186;54m');
  });

  test('pads the rows outside the indicator range and can draw it on both sides', () => {
    expect(renderLaneLinesWithProgressIndicators(['a', 'b'], 0, 10, 1, 1, true).map(stripAnsi)).toEqual([' a ', '┃b┃']);
    expect(renderLaneLinesWithProgressIndicators([], 0, 10, 0, 0, true)).toEqual([]);
  });
});

describe('renderLaneBlockWithBga', () => {
  test('keeps the lanes alone without a BGA', () => {
    const laneLines = ['L1', 'L2'];
    expect(renderLaneBlockWithBga(laneLines)).toBe(laneLines);
    expect(renderLaneBlockWithBga(laneLines, [])).toBe(laneLines);
  });

  test('draws the BGA backgrounds beside the lanes, centered and padded in black', () => {
    expect(renderLaneBlockWithBga(['L1', 'L2', 'L3'], [`\u001b[48;2;10;20;30m  ${ANSI_RESET}`])).toEqual([
      `L1   ${BLACK_CELLS}`,
      `L2   \u001b[48;2;10;20;30m  ${ANSI_RESET}`,
      `L3   ${BLACK_CELLS}`,
    ]);
  });
});

describe('renderLaneBlockWithKittyPadding', () => {
  test('pads the lanes to one width and reserves the BGA cells for the image', () => {
    expect(renderLaneBlockWithKittyPadding(['ab', 'abcd'], 2)).toEqual({
      lines: [`ab${ANSI_RESET}     ${BLACK_CELLS}`, `abcd${ANSI_RESET}   ${BLACK_CELLS}`],
      column: 8,
    });
  });
});
