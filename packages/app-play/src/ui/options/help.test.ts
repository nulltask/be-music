import { describe, expect, test } from 'vite-plus/test';
import { optionHelpLabels, optionHelpSection, placeOptionHelpTip, resolveOptionHelpChoices } from './help.ts';

describe('optionHelpLabels', () => {
  test('names the control its own text names', () => {
    expect(optionHelpLabels(' Auto play ', undefined)).toEqual(['Auto play']);
    expect(optionHelpLabels('Open files (ZIP / replay)', '')).toEqual(['Open files (ZIP / replay)']);
  });

  test('names every control of its data-for list, which a slash in a label does not split', () => {
    expect(optionHelpLabels('Random 1P / Random 2P', 'Random 1P|Random 2P')).toEqual(['Random 1P', 'Random 2P']);
    expect(optionHelpLabels('Tempo · Hi-speed · SUDDEN+ / HIDDEN+ · LIFT', 'Tempo| SUDDEN+ / HIDDEN+ ||LIFT')).toEqual([
      'Tempo',
      'SUDDEN+ / HIDDEN+',
      'LIFT',
    ]);
  });
});

describe('optionHelpSection', () => {
  const sections = new Set(['Top', 'Play options', 'Replay / ghost', 'Audio', 'Library & records']);

  test('takes the nearest folder Help has a section for', () => {
    expect(optionHelpSection(['Replay / ghost', 'Play options'], sections)).toBe('Replay / ghost');
    expect(optionHelpSection(['Stages', 'Compressor', 'Audio'], sections)).toBe('Audio');
  });

  test('files a control outside every such folder under Top', () => {
    expect(optionHelpSection([], sections)).toBe('Top');
    expect(optionHelpSection(['Custom offsets'], sections)).toBe('Top');
  });
});

describe('placeOptionHelpTip', () => {
  const viewport = { width: 800, height: 600 };
  const tip = { width: 200, height: 60 };

  test('opens below the button, centred on it, with the point under its centre', () => {
    expect(placeOptionHelpTip({ left: 390, top: 100, width: 20, height: 20 }, tip, viewport)).toEqual({
      left: 300,
      top: 130,
      side: 'bottom',
      arrowX: 100,
    });
  });

  test('opens above the button when the viewport has no room below', () => {
    expect(placeOptionHelpTip({ left: 390, top: 540, width: 20, height: 20 }, tip, viewport)).toMatchObject({
      top: 470,
      side: 'top',
    });
  });

  test('stays inside the viewport and keeps the point on the button near an edge', () => {
    expect(placeOptionHelpTip({ left: 770, top: 100, width: 20, height: 20 }, tip, viewport)).toMatchObject({
      left: 592,
      arrowX: 188,
    });
    expect(placeOptionHelpTip({ left: 0, top: 100, width: 20, height: 20 }, tip, viewport)).toMatchObject({
      left: 8,
      arrowX: 12,
    });
  });
});

describe('resolveOptionHelpChoices', () => {
  const choices = [
    ['OFF', 'Shows none.'],
    [['SLOT 1', 'SLOT 2'], 'A replay slot.', 'SLOT 1 – 2'],
    [['HARD', 'EX-HARD'], 'A survival gauge.'],
    ['DEATH', 'Fails on one miss.'],
  ] as const;

  test('lists the choices the list offers, in its order, and marks the one picked', () => {
    expect(resolveOptionHelpChoices(choices, ['DEATH', 'OFF'], 'OFF')).toEqual([
      { label: 'DEATH', help: 'Fails on one miss.', current: false },
      { label: 'OFF', help: 'Shows none.', current: true },
    ]);
  });

  test('shows a group once, under its label or the names of those offered', () => {
    expect(resolveOptionHelpChoices(choices, ['OFF', 'SLOT 1', 'SLOT 2', 'HARD'], 'SLOT 2')).toEqual([
      { label: 'OFF', help: 'Shows none.', current: false },
      { label: 'SLOT 1 – 2', help: 'A replay slot.', current: true },
      { label: 'HARD', help: 'A survival gauge.', current: false },
    ]);
    expect(resolveOptionHelpChoices(choices, ['EX-HARD', 'HARD']).map((line) => line.label)).toEqual([
      'HARD / EX-HARD',
    ]);
  });

  test('lists nothing for a list none of whose options it knows', () => {
    expect(resolveOptionHelpChoices(choices, ['1', '2'], '1')).toEqual([]);
  });
});
