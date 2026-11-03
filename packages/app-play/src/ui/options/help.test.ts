import { describe, expect, test } from 'vite-plus/test';
import { optionHelpLabels, optionHelpSection } from './help.ts';

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
