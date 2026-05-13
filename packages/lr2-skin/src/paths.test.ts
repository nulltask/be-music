import { describe, expect, it } from 'vitest';
import {
  LR2_SKIN_INFORMATION_TYPE,
  informationTypeToKind,
  informationTypeToPlayVariant,
  isSkinPathOfKind,
  peekLr2SkinInformationType,
  scoreSkinPath,
} from './paths.ts';

describe('isSkinPathOfKind', () => {
  it('matches LR2 screen folders with either slash style', () => {
    expect(isSkinPathOfKind('LR2files/Theme/LR2/Play/play_7.lr2skin', 'play')).toBe(true);
    expect(isSkinPathOfKind(String.raw`LR2files\Theme\LR2\Select\select.lr2skin`, 'select')).toBe(true);
    expect(isSkinPathOfKind('LR2files/Theme/LR2/Decide/decide.lr2skin', 'decide')).toBe(true);
  });

  it('keeps courseresult as a low-priority result candidate', () => {
    expect(isSkinPathOfKind('LR2files/Theme/LR2/CourseResult/result.lr2skin', 'result')).toBe(true);
    expect(isSkinPathOfKind('LR2files/Theme/LR2/Result/result.lr2skin', 'result')).toBe(true);
  });
});

describe('scoreSkinPath', () => {
  it('prioritizes an explicitly requested play variant', () => {
    expect(scoreSkinPath('LR2files/Theme/LR2/Play/play_14.lr2skin', 'play', '14')).toBe(-1);
    expect(scoreSkinPath('LR2files/Theme/LR2/Play/play_7.lr2skin', 'play', '14')).toBe(0);
  });

  it('prefers exact select / result / decide filenames over loose matches', () => {
    expect(scoreSkinPath('LR2files/Theme/LR2/Select/select.lr2skin', 'select')).toBe(0);
    expect(scoreSkinPath('LR2files/Theme/LR2/Select/select_old.lr2skin', 'select')).toBe(10);
    expect(scoreSkinPath('LR2files/Theme/LR2/Result/result.lr2skin', 'result')).toBe(0);
    expect(scoreSkinPath('LR2files/Theme/LR2/Decide/decide.lr2skin', 'decide')).toBe(0);
  });

  it('penalizes course-result and half-play skins as fallbacks', () => {
    expect(scoreSkinPath('LR2files/Theme/LR2/CourseResult/result.lr2skin', 'result')).toBe(90);
    expect(scoreSkinPath('LR2files/Theme/LR2/Play/play_half.lr2skin', 'play')).toBe(50);
  });

  describe('options object overload (type-aware scoring)', () => {
    // LITONE4 ships `AC7.lr2skin` (type=0 = play, 7-keys) instead of the canonical `play_7.lr2skin`. With only the
    // filename heuristic the file would score 100 (catch-all) and never get picked; the type-aware fallback drops it
    // into the 19-20 tier — below the canonical names but above the catch-all.
    it('ranks LITONE4-style play skins via the declared #INFORMATION type', () => {
      const score = scoreSkinPath('LR2files/Theme/LITONE4/Play/AC7.lr2skin', 'play', {
        type: LR2_SKIN_INFORMATION_TYPE.PLAY_7KEYS,
      });
      expect(score).toBe(20);
    });

    it('prefers the declared variant over a non-variant play skin of the same type', () => {
      // Two play skins, both type=0, both non-canonical filenames. The one whose declared variant matches the
      // request beats the other by one rank.
      const matching = scoreSkinPath('LR2files/Theme/X/Play/AC7.lr2skin', 'play', {
        variant: '7',
        type: LR2_SKIN_INFORMATION_TYPE.PLAY_7KEYS,
      });
      const generic = scoreSkinPath('LR2files/Theme/X/Play/AC5.lr2skin', 'play', {
        variant: '7',
        type: LR2_SKIN_INFORMATION_TYPE.PLAY_5KEYS,
      });
      expect(matching).toBeLessThan(generic);
    });

    it('routes select / decide / result skins via type when path is outside the canonical folders', () => {
      // Paths that DO match `/select` / `/decide` / `/result` via the filename heuristic already land in the 0..10
      // tier — the type fallback only matters when the file lives outside those folders (e.g. a flat theme bundle
      // with everything under `Theme/X/`). Asserting that the type fallback is exactly 20 prevents the score from
      // accidentally regressing to the catch-all 100 if the heuristic chain is ever simplified.
      expect(
        scoreSkinPath('LR2files/Theme/X/blue.lr2skin', 'select', {
          type: LR2_SKIN_INFORMATION_TYPE.MUSIC_SELECT,
        }),
      ).toBe(20);
      expect(
        scoreSkinPath('LR2files/Theme/X/d2.lr2skin', 'decide', {
          type: LR2_SKIN_INFORMATION_TYPE.DECIDE,
        }),
      ).toBe(20);
      expect(
        scoreSkinPath('LR2files/Theme/X/r2.lr2skin', 'result', {
          type: LR2_SKIN_INFORMATION_TYPE.RESULT,
        }),
      ).toBe(20);
    });

    it('still uses the filename heuristic (score 10) for type-tagged files inside canonical folders', () => {
      // `Select/blue.lr2skin` is in a `/select` folder but isn't named `select.lr2skin` — that's the loose-match
      // tier (10). With the type tag the result is unchanged because the filename heuristic is checked first.
      expect(
        scoreSkinPath('LR2files/Theme/LITONE4/Select/blue.lr2skin', 'select', {
          type: LR2_SKIN_INFORMATION_TYPE.MUSIC_SELECT,
        }),
      ).toBe(10);
    });

    it('keeps the catch-all 100 for type-less play skins with non-canonical names', () => {
      // Unrecognised filename AND no `#INFORMATION` type → score 100 (= "definitively not this kind").
      expect(scoreSkinPath('LR2files/Theme/X/Play/AC7.lr2skin', 'play', {})).toBe(100);
    });

    it('canonical filenames still outrank type-only matches', () => {
      // A theme that ships both `play_7.lr2skin` AND a type-tagged `AC7.lr2skin` should prefer the canonical name.
      const canonical = scoreSkinPath('LR2files/Theme/LR2/Play/play_7.lr2skin', 'play', {
        variant: '7',
        type: LR2_SKIN_INFORMATION_TYPE.PLAY_7KEYS,
      });
      const typeOnly = scoreSkinPath('LR2files/Theme/LR2/Play/AC7.lr2skin', 'play', {
        variant: '7',
        type: LR2_SKIN_INFORMATION_TYPE.PLAY_7KEYS,
      });
      expect(canonical).toBeLessThan(typeOnly);
    });
  });
});

describe('informationTypeToKind / informationTypeToPlayVariant', () => {
  it('maps play codes 0..4 to "play"', () => {
    expect(informationTypeToKind(0)).toBe('play');
    expect(informationTypeToKind(1)).toBe('play');
    expect(informationTypeToKind(2)).toBe('play');
    expect(informationTypeToKind(3)).toBe('play');
    expect(informationTypeToKind(4)).toBe('play');
  });

  it('maps select / decide / result codes', () => {
    expect(informationTypeToKind(5)).toBe('select');
    expect(informationTypeToKind(6)).toBe('decide');
    expect(informationTypeToKind(7)).toBe('result');
  });

  it('returns undefined for codes we do not consume', () => {
    expect(informationTypeToKind(8)).toBeUndefined(); // key-config
    expect(informationTypeToKind(9)).toBeUndefined(); // skin-select
    expect(informationTypeToKind(99)).toBeUndefined();
  });

  it('extracts the play variant from play codes only', () => {
    expect(informationTypeToPlayVariant(0)).toBe('7');
    expect(informationTypeToPlayVariant(1)).toBe('5');
    expect(informationTypeToPlayVariant(2)).toBe('9');
    expect(informationTypeToPlayVariant(3)).toBe('10');
    expect(informationTypeToPlayVariant(4)).toBe('14');
    expect(informationTypeToPlayVariant(5)).toBeUndefined();
    expect(informationTypeToPlayVariant(6)).toBeUndefined();
  });
});

describe('peekLr2SkinInformationType', () => {
  function sjis(text: string): Uint8Array {
    // Helper that encodes test fixtures as SJIS bytes — same encoding the loader sees on real `.lr2skin` files.
    // We only need a Node-side fallback; the strings in these tests are ASCII so SJIS / UTF-8 byte sequences
    // coincide. `TextEncoder('utf-8')` is good enough.
    return new TextEncoder().encode(text);
  }

  it('returns the parsed type for a canonical #INFORMATION row', () => {
    const bytes = sjis('//comment\n#INFORMATION,0,LR2 default play 7K,LR2 staff,thumbnail.bmp,\n');
    expect(peekLr2SkinInformationType(bytes)).toBe(0);
  });

  it('parses each of the recognized type codes', () => {
    for (const type of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(peekLr2SkinInformationType(sjis(`#INFORMATION,${type},name,author,thumb.bmp,\n`))).toBe(type);
    }
  });

  it('ignores commented-out information rows', () => {
    const bytes = sjis('//#INFORMATION,99,fake,\n#INFORMATION,5,real select,author,t.bmp,\n');
    expect(peekLr2SkinInformationType(bytes)).toBe(5);
  });

  it('accepts tab-delimited rows (LR2 CSV parser quirk)', () => {
    const bytes = sjis('#INFORMATION\t7\treal result\tauthor\tthumb.bmp\t\n');
    expect(peekLr2SkinInformationType(bytes)).toBe(7);
  });

  it('returns undefined when no #INFORMATION line is present', () => {
    expect(peekLr2SkinInformationType(sjis('//comment only\n#IMAGE,foo.bmp,\n'))).toBeUndefined();
  });

  it('returns undefined for empty or undefined input', () => {
    expect(peekLr2SkinInformationType(undefined)).toBeUndefined();
    expect(peekLr2SkinInformationType(new Uint8Array())).toBeUndefined();
  });

  it('returns undefined when the type field is not a finite integer', () => {
    expect(peekLr2SkinInformationType(sjis('#INFORMATION,abc,name,author,thumb.bmp,\n'))).toBeUndefined();
  });

  it('handles a BOM-prefixed file', () => {
    // UTF-8 BOM byte sequence at the start. The decoder strips it before searching for `#INFORMATION`.
    const head = new Uint8Array([0xef, 0xbb, 0xbf]);
    const rest = sjis('#INFORMATION,6,decide,author,thumb.bmp,\n');
    const bytes = new Uint8Array(head.length + rest.length);
    bytes.set(head, 0);
    bytes.set(rest, head.length);
    expect(peekLr2SkinInformationType(bytes)).toBe(6);
  });

  it('skips a line longer than 4 KiB at the top of the file', () => {
    // `#INFORMATION` falls outside the 4 KiB scan window — we deliberately don't decode further to keep the peek
    // cheap. Authored themes never have payloads this large before the header in practice.
    const filler = '//' + 'x'.repeat(5000) + '\n';
    const bytes = sjis(filler + '#INFORMATION,5,buried,\n');
    expect(peekLr2SkinInformationType(bytes)).toBeUndefined();
  });
});
