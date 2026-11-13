import { describe, expect, test } from 'vite-plus/test';
import { OPTION_HELP_CHOICES_JA } from './help-choices-ja.ts';
import { OPTION_HELP_CHOICES, type OptionHelpChoices } from './help-choices.ts';

/** Each list's choices without their help: `section\nlabel` to the names and label of every choice. */
function shape(choices: OptionHelpChoices): Record<string, unknown> {
  const rows: Record<string, unknown> = {};
  for (const [section, lists] of Object.entries(choices)) {
    for (const [label, list] of Object.entries(lists)) {
      rows[`${section}\n${label}`] = list.map(([names, , group]) => [names, group]);
    }
  }
  return rows;
}

describe('OPTION_HELP_CHOICES', () => {
  test('describes the same choices in English and Japanese', () => {
    expect(shape(OPTION_HELP_CHOICES_JA)).toEqual(shape(OPTION_HELP_CHOICES));
  });

  test('gives every choice a help text and names an option once per list', () => {
    for (const choices of [OPTION_HELP_CHOICES, OPTION_HELP_CHOICES_JA]) {
      for (const lists of Object.values(choices)) {
        for (const list of Object.values(lists)) {
          const names = list.flatMap(([names]) => (typeof names === 'string' ? [names] : names));
          expect(new Set(names).size).toBe(names.length);
          for (const [, help] of list) expect(help.trim()).not.toBe('');
        }
      }
    }
  });
});
