import { describe, expect, test } from 'vite-plus/test';
import { OPTION_FOLDERS, OPTIONS_TABS, PLAY_OPTION_PAGES, VIEW_OPTION_PAGES } from './folders.ts';
import { OPTION_LABELS_JA, optionLabel, splitOptionLabelSource } from './labels.ts';
import { LANE_KEY_CONFIG } from '@be-music/player-engine/lanes';
import { laneKeyConfigLabel } from './keys.ts';
import { CONTROL_ACTIONS } from '@be-music/player-browser/host';
import { actionKeyConfigLabel, actionKeyLabel, keyCodeLabel } from './action-keys.ts';

describe('optionLabel', () => {
  test('shows the Japanese label in Japanese and the English one otherwise', () => {
    expect(optionLabel('Auto play', 'ja')).toBe('オートプレイ');
    expect(optionLabel('Auto play', 'en')).toBe('Auto play');
  });

  test('keeps a label the table does not have, such as a skin setting', () => {
    expect(optionLabel('Lane glow', 'ja')).toBe('Lane glow');
  });
});

describe('OPTION_LABELS_JA', () => {
  test('gives every entry a text', () => {
    for (const [label, text] of Object.entries(OPTION_LABELS_JA)) expect(text.trim(), label).not.toBe('');
  });

  test('covers every tab, Play options and View page and folder title', () => {
    const titles = [
      ...OPTIONS_TABS,
      ...PLAY_OPTION_PAGES,
      ...VIEW_OPTION_PAGES,
      ...Object.values(OPTION_FOLDERS).map(({ title }) => title),
    ];
    for (const title of titles) expect(OPTION_LABELS_JA, title).toHaveProperty([title]);
  });
});

describe('key config labels', () => {
  test('names every lane of each group, in Japanese too', () => {
    for (const group of ['beat', 'popn'] as const) {
      for (const lane of LANE_KEY_CONFIG[group]) {
        const label = laneKeyConfigLabel(group, lane);
        expect(OPTION_LABELS_JA, label).toHaveProperty([label]);
      }
    }
    expect(LANE_KEY_CONFIG.beat.map((lane) => laneKeyConfigLabel('beat', lane)).slice(0, 3)).toEqual([
      '1P scratch',
      '1P key 1',
      '1P key 2',
    ]);
    expect(laneKeyConfigLabel('popn', LANE_KEY_CONFIG.popn[8]!)).toBe('Key 9');
  });
});

describe('screen key config labels', () => {
  test('names every operation in Japanese too, with the key map an operation only one has', () => {
    for (const action of CONTROL_ACTIONS) {
      const label = actionKeyConfigLabel(action);
      expect(OPTION_LABELS_JA, label).toHaveProperty([label]);
    }
    expect(actionKeyConfigLabel(CONTROL_ACTIONS.find((action) => action.id === 'select.page-down')!)).toBe(
      'Ten bars down (beatoraja)',
    );
    expect(actionKeyLabel({ button: '1P-start' })).toBe('1P START');
    expect(actionKeyLabel({ button: '1P-key6' })).toBe('1P key 6');
    expect(actionKeyLabel({ button: '1P-scratch-ccw' })).toBe('1P scratch ↺');
    expect(['KeyR', 'Digit4', 'ArrowDown', 'Numpad0', 'Escape', 'F5'].map(keyCodeLabel)).toEqual([
      'R',
      '4',
      '↓',
      'Num 0',
      'Esc',
      'F5',
    ]);
  });
});

describe('splitOptionLabelSource', () => {
  test('splits a source off the end of a label', () => {
    expect(splitOptionLabelSource('Scroll (beatoraja)')).toEqual({ text: 'Scroll', source: 'beatoraja' });
    expect(splitOptionLabelSource('EXTRA MODE (LR2)')).toEqual({ text: 'EXTRA MODE', source: 'LR2' });
    expect(splitOptionLabelSource('ANY KEY (PC)')).toEqual({ text: 'ANY KEY', source: 'PC' });
    expect(splitOptionLabelSource('Normal HI-SPEED (AC 32 measured)')).toEqual({
      text: 'Normal HI-SPEED',
      source: 'AC 32 measured',
    });
    expect(splitOptionLabelSource('表示範囲の固定 (AC 34)')).toEqual({ text: '表示範囲の固定', source: 'AC 34' });
  });

  test('keeps a note that is not a source alone in the text', () => {
    for (const label of [
      'Fixed key 1P (LR2; 0=default)',
      'Seed 1P (-1=random)',
      'Master (%)',
      'Gauge',
      'Ratio (x:1)',
    ]) {
      expect(splitOptionLabelSource(label)).toEqual({ text: label });
    }
  });
});
