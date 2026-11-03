import { describe, expect, test } from 'vite-plus/test';
import { OPTION_FOLDERS, OPTIONS_TABS, PLAY_OPTION_PAGES } from './folders.ts';
import { OPTION_LABELS_JA, optionLabel } from './labels.ts';

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
