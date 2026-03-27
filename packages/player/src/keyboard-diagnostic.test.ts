import { describe, expect, test } from 'vitest';
import { inspectInputTokenEvent } from './manual-input.ts';

describe('keyboard diagnostic', () => {
  test('reports protocol inspections for printable keys', () => {
    const inspection = inspectInputTokenEvent('a', {
      name: 'a',
      sequence: 'a',
      ctrl: false,
      meta: false,
      shift: false,
    });

    expect(inspection.selected.protocol).toBe('legacy');
    expect(inspection.protocols.legacy.detected).toBe(true);
    expect(inspection.protocols.legacy.tokens).toContain('a');
    expect(inspection.protocols.kitty.detected).toBe(false);
    expect(inspection.protocols.win32.detected).toBe(false);
  });

  test('reports protocol inspections for win32 input records', () => {
    const inspection = inspectInputTokenEvent('\u001b[67;46;3;1;8;1_', {
      name: undefined,
      sequence: '\u001b[67;46;3;1;8;1_',
      ctrl: false,
      meta: false,
      shift: false,
    });

    expect(inspection.selected.protocol).toBe('win32');
    expect(inspection.protocols.win32.detected).toBe(true);
    expect(inspection.protocols.win32.tokens).toContain('ctrl+c');
  });
});
