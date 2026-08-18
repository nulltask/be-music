import { stripComment } from './csv.ts';

/**
 * Which screen's `.lr2skin` to pick when a theme bundle ships multiple (play, select, result, decide, etc.).
 */
export type Lr2SkinKind = 'play' | 'select' | 'result' | 'decide';

/**
 * `play_N.lr2skin` variant hint for the play-skin loader.
 */
export type Lr2PlayVariant = '5' | '7' | '9' | '10' | '14';

/**
 * Numeric type code declared by each `.lr2skin`'s `#INFORMATION,<type>,<title>,<author>,<thumbnail>` header.
 * Authored skins use this to tell LR2 which scene they belong to — independent of filename conventions like
 * `play_7.lr2skin`. Themes that don't follow the canonical filenames (LITONE4 ships `AC7.lr2skin` for 7-keys, etc.)
 * still classify correctly when discovery consults the `#INFORMATION` line.
 *
 * Codes mirror the LR2 source's `SKIN_TYPE_*` enum:
 *
 * - 0..4 — Play, key-mode subdivided (7K / 5K / 9K / 10K / 14K).
 * - 5    — Music select.
 * - 6    — Decide (pre-play splash).
 * - 7    — Result.
 * - 8    — Key config (out of scope — player config screen).
 * - 9    — Skin select (also out of scope — we replace this UI with the Debug Menu's theme picker).
 */
export const LR2_SKIN_INFORMATION_TYPE = {
  PLAY_7KEYS: 0,
  PLAY_5KEYS: 1,
  PLAY_9KEYS: 2,
  PLAY_10KEYS: 3,
  PLAY_14KEYS: 4,
  MUSIC_SELECT: 5,
  DECIDE: 6,
  RESULT: 7,
  KEY_CONFIG: 8,
  SKIN_SELECT: 9,
} as const;

export type Lr2SkinInformationType = (typeof LR2_SKIN_INFORMATION_TYPE)[keyof typeof LR2_SKIN_INFORMATION_TYPE];

/**
 * Maps an `#INFORMATION,<type>` code onto our internal {@link Lr2SkinKind}. Returns `undefined` for codes we don't
 * (yet) consume — namely key-config (8) and skin-select (9). Play codes 0..4 all map to `'play'`; the key-mode
 * subdivision is recovered separately via {@link informationTypeToPlayVariant} when the caller needs it (typically
 * for variant-aware play-skin scoring).
 */
export function informationTypeToKind(type: number): Lr2SkinKind | undefined {
  if (type >= 0 && type <= 4) return 'play';
  if (type === 5) return 'select';
  if (type === 6) return 'decide';
  if (type === 7) return 'result';
  return undefined;
}

/**
 * Maps a play-kind `#INFORMATION` type (0..4) onto its canonical {@link Lr2PlayVariant}. Returns `undefined` for
 * non-play codes — callers that need the play variant should branch on {@link informationTypeToKind} first.
 */
export function informationTypeToPlayVariant(type: number): Lr2PlayVariant | undefined {
  switch (type) {
    case LR2_SKIN_INFORMATION_TYPE.PLAY_7KEYS:
      return '7';
    case LR2_SKIN_INFORMATION_TYPE.PLAY_5KEYS:
      return '5';
    case LR2_SKIN_INFORMATION_TYPE.PLAY_9KEYS:
      return '9';
    case LR2_SKIN_INFORMATION_TYPE.PLAY_10KEYS:
      return '10';
    case LR2_SKIN_INFORMATION_TYPE.PLAY_14KEYS:
      return '14';
    default:
      return undefined;
  }
}

/**
 * Peek-only scan of a `.lr2skin` payload to recover its `#INFORMATION,<type>,...` declaration. Returns the parsed
 * numeric type (0..9 per {@link LR2_SKIN_INFORMATION_TYPE}) when found, or `undefined` when no `#INFORMATION` line is
 * present or the type field doesn't parse as a finite integer.
 *
 * We cap the decoded prefix at 4 KiB because authored themes universally put `#INFORMATION` near the file top —
 * scanning past the header just wastes CPU on large play CSVs (LITONE4's `AC7LEFT.csv` is 3138 lines / ~250 KiB after
 * include resolution but the `#INFORMATION` in its parent `.lr2skin` lands inside the first ~500 bytes).
 *
 * The decoder is permissive (`fatal: false`) and the comment-stripping mirrors {@link stripComment} so commented-out
 * `// #INFORMATION,...` lines don't leak into the result.
 */
export function peekLr2SkinInformationType(bytes: Uint8Array | undefined): number | undefined {
  if (!bytes || bytes.length === 0) return undefined;
  // Strip a leading UTF-8 BOM (`0xEF 0xBB 0xBF`) at the byte level before handing the prefix to the SJIS decoder.
  // The raw BOM bytes aren't valid SJIS, so leaving them in produces undefined garbage chars at the start of the
  // decoded string and the `#INFORMATION` line scan misses the first row. Real-world theme CSVs occasionally ship
  // with a UTF-8 BOM (some authoring tools insert it even on SJIS files), so handling it here is cheap insurance.
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3;
  }
  const head = bytes.subarray(start, Math.min(bytes.length, start + 4096));
  // SJIS is the canonical encoding for LR2 theme CSVs. `TextDecoder` keeps `0x5C` as the ASCII backslash regardless of
  // whether it should be rendered as a Japanese yen sign — fine for our purposes since we only read the type field
  // which is plain ASCII digits.
  const text = new TextDecoder('shift_jis', { fatal: false }).decode(head).replace(/^﻿/u, '');
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = stripComment(rawLine).trim();
    if (!line.startsWith('#INFORMATION')) continue;
    // Tab and comma are both accepted by LR2's CSV parser; `parseRow` in `csv.ts` does the same. Avoid importing the
    // full row parser here — we only need the first numeric field.
    const delimiter = line.includes('\t') ? '\t' : ',';
    const parts = line.split(delimiter);
    if (parts.length < 2) return undefined;
    const value = parts[1]?.trim();
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function isSkinPathOfKind(path: string, kind: Lr2SkinKind): boolean {
  const lower = path.toLowerCase();
  if (kind === 'play') {
    return lower.includes('/play') || lower.includes('\\play');
  }
  if (kind === 'result') {
    const sansCourse = lower.replace(/\/courseresult\//gu, '/').replace(/\\courseresult\\/gu, '\\');
    return sansCourse.includes('/result') || sansCourse.includes('\\result');
  }
  if (kind === 'decide') {
    return lower.includes('/decide') || lower.includes('\\decide');
  }
  return lower.includes('/select') || lower.includes('\\select');
}

/**
 * Optional inputs to {@link scoreSkinPath} that bias the result toward the caller's specific intent.
 */
export interface ScoreSkinPathOptions {
  /** Bias the play-kind scoring toward `play_<variant>.lr2skin`. Ignored for non-play kinds. */
  variant?: Lr2PlayVariant;
  /**
   * Parsed `#INFORMATION,<type>` code (see {@link peekLr2SkinInformationType}). When present, candidates whose
   * declared type matches the requested {@link Lr2SkinKind} are awarded a "mid-range" score that ranks **below** the
   * canonical filenames (`select.lr2skin` = 0, `play_7.lr2skin` = 0, etc.) but **above** the catch-all 100.
   *
   * This lets type-honest themes that don't follow the canonical filename convention (LITONE4's `AC7.lr2skin` for
   * type=0 play, etc.) win against unrelated `.lr2skin` files in the same bundle without overriding LR2-default's
   * preferred ordering.
   */
  type?: number;
}

/**
 * Backward-compatible legacy signature for the play-skin variant bias. Newer callers should prefer the options-object
 * overload so `type` can be threaded in as well.
 */
export function scoreSkinPath(path: string, kind: Lr2SkinKind, variant?: Lr2PlayVariant): number;
export function scoreSkinPath(path: string, kind: Lr2SkinKind, options: ScoreSkinPathOptions): number;
export function scoreSkinPath(
  path: string,
  kind: Lr2SkinKind,
  variantOrOptions?: Lr2PlayVariant | ScoreSkinPathOptions,
): number {
  const options =
    typeof variantOrOptions === 'string' || variantOrOptions === undefined
      ? { variant: variantOrOptions }
      : variantOrOptions;
  const lower = path.toLowerCase();
  // Filename-based ranking comes first — the canonical LR2 names (`play_7.lr2skin`, `select.lr2skin`, …) stay at the
  // sub-10 tier so themes that DO use them aren't perturbed by the new type lookup.
  if (kind === 'select') {
    if (lower.endsWith('/select.lr2skin')) return 0;
    if (lower.includes('/select') && lower.endsWith('.lr2skin')) return 10;
    return informationTypeMatches(options.type, kind) ? 20 : 100;
  }
  if (kind === 'result') {
    if (lower.includes('/courseresult')) return 90;
    if (lower.endsWith('/result.lr2skin')) return 0;
    if (lower.includes('/result') && lower.endsWith('.lr2skin')) return 10;
    return informationTypeMatches(options.type, kind) ? 20 : 100;
  }
  if (kind === 'decide') {
    if (lower.endsWith('/decide.lr2skin')) return 0;
    if (lower.includes('/decide') && lower.endsWith('.lr2skin')) return 10;
    return informationTypeMatches(options.type, kind) ? 20 : 100;
  }
  if (options.variant && lower.endsWith(`/play_${options.variant}.lr2skin`)) return -1;
  if (lower.endsWith('/play_7.lr2skin')) return 0;
  if (lower.endsWith('/play_5.lr2skin')) return 1;
  if (lower.endsWith('/play_9.lr2skin')) return 2;
  if (lower.endsWith('/play_10.lr2skin')) return 3;
  if (lower.endsWith('/play_14.lr2skin')) return 4;
  if (lower.includes('/play_') && !lower.includes('play_half')) return 30;
  if (lower.includes('play_half')) return 50;
  // Type-aware fallback for play skins with non-canonical filenames (LITONE4's `AC7.lr2skin`, etc.). A play skin
  // whose declared variant matches the requested one outranks one that doesn't, mirroring the `play_N` tier above.
  if (informationTypeMatches(options.type, 'play')) {
    const declaredVariant = options.type !== undefined ? informationTypeToPlayVariant(options.type) : undefined;
    if (options.variant !== undefined && declaredVariant === options.variant) return 19;
    return 20;
  }
  return 100;
}

function informationTypeMatches(type: number | undefined, kind: Lr2SkinKind): boolean {
  if (type === undefined) return false;
  return informationTypeToKind(type) === kind;
}
