import { describe, expect, test } from 'vite-plus/test';
import { CONTROL_ACTIONS, type ControlActionDefinition } from '@be-music/player-browser/host';
import { screenKeyHelpText } from './help-template.ts';

const definitions = CONTROL_ACTIONS as readonly ControlActionDefinition[];

describe('screenKeyHelpText', () => {
  test('names the operation and its screen', () => {
    const next = definitions.find((action) => action.screen === 'select' && action.label === 'Next bar')!;
    expect(screenKeyHelpText(next, 'en')).toBe('The keys for “Next bar” on the select screen.');
    expect(screenKeyHelpText(next, 'ja')).toMatch(/^選曲画面で「.+」を行うキー。$/u);
  });

  test('says which key map has an operation only one has', () => {
    const only = definitions.find((action) => Object.keys(action.defaults).length === 1)!;
    expect(screenKeyHelpText(only, 'en')).toMatch(/Only (LR2|beatoraja)'s key map has it\.$/u);
  });

  test('gives every operation its own text', () => {
    for (const lang of ['en', 'ja'] as const) {
      const texts = definitions.map((action) => screenKeyHelpText(action, lang));
      expect(new Set(texts).size).toBe(texts.length);
    }
  });
});
