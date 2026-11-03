import { describe, expect, test } from 'vite-plus/test';
import { OPTION_FOLDERS, OPTIONS_TABS, PLAY_OPTION_PAGES } from './folders.ts';
import { OPTION_LABELS_JA, optionLabel } from './labels.ts';
import { LANE_KEY_CONFIG } from '@be-music/player-engine/lanes';
import { laneKeyConfigLabel } from './keys.ts';

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

  test('covers every tab, Play options page and folder title', () => {
    const titles = [...OPTIONS_TABS, ...PLAY_OPTION_PAGES, ...Object.values(OPTION_FOLDERS).map(({ title }) => title)];
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
