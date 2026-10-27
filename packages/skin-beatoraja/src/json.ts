// JSON skin parsing.
//
// beatoraja `.json` skins use JSON5-style trailing commas in places (the reference theme's `play5.json` ends an
// `item` array with `,]`). We strip trailing commas before handing the text to `JSON.parse` so authors don't have to
// worry about that gotcha.

import { normalizeBeatorajaSkinCustomOffsets } from './types.ts';
import type { BeatorajaSkin, BeatorajaSkinHeader } from './types.ts';

/**
 * Parse a beatoraja JSON skin file into a typed tree. Throws on syntax errors; callers wrap that into their own
 * load-failure surface (consistent with the Lua evaluator's Result-typed error).
 */
export function parseBeatorajaSkinJSON(source: Uint8Array | string): BeatorajaSkin {
  const text = typeof source === 'string' ? source : new TextDecoder('utf-8').decode(source);
  const sanitized = relaxBeatorajaJSON(text);
  const parsed = JSON.parse(sanitized) as Record<string, unknown>;
  return parsed as BeatorajaSkin;
}

/**
 * Read just the header section without parsing the (potentially large) element arrays. We currently parse the whole
 * tree because beatoraja JSON skins are ≤ a few hundred KB and `JSON.parse` is much faster than a hand-rolled
 * partial tokenizer; the field exists to stay symmetric with the Lua side, where `parseBeatorajaSkinHeader` is the
 * cheap path that avoids running `main()`.
 */
export function parseBeatorajaSkinJSONHeader(source: Uint8Array | string): BeatorajaSkinHeader {
  const skin = parseBeatorajaSkinJSON(source);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {
    source: _src,
    font: _font,
    image: _img,
    value: _val,
    text: _txt,
    slider: _sl,
    destination: _dst,
    ...header
  } = skin;
  return {
    ...header,
    offset: normalizeBeatorajaSkinCustomOffsets((header as Readonly<Record<string, unknown>>).offset),
  } as BeatorajaSkinHeader;
}

/**
 * Relax a beatoraja JSON skin source into something `JSON.parse` will accept. The reference theme's `play*.json`
 * deviates from RFC 8259 in three ways verified against the bundled fixtures:
 *
 * 1. **Trailing commas** before `]` / `}` (e.g. `play5.json`'s property item array ends with `…},]`).
 * 2. **Missing commas** between adjacent objects or arrays — `}\n\t{` is accepted by beatoraja's parser as if a `,`
 *    had been written. This shows up in `play24.json` line 715 (`{...]}\n\t{...}` between `#15` and `notes`).
 * 3. **Doubled-open brace typo** `{{` in value position — `play5.json` line 307 emits
 *    `"value": {{"x":20, "y":140, ...}}` where the second `{` is a literal author typo (the matching close is
 *    NOT doubled — the `}}` at the end closes both the value object and the surrounding entry object as
 *    intended). libgdx's permissive parser silently drops the extra `{`; we mirror that by skipping the FIRST
 *    of any `{{` pair (and only the first — the closes already balance once that one is gone).
 *
 * We fix all three by walking the source character-by-character with a tiny state machine that tracks string
 * boundaries.
 *
 * Line / block comments and unquoted keys are NOT supported — none of the bundled skins use those, and
 * `JSON.parse` will reject them with a clear error if a community theme tries.
 */
export function relaxBeatorajaJSON(source: string): string {
  // Untouched runs are copied as slices: `start` is where the pending run begins, and an edit flushes it.
  let result = '';
  let start = 0;
  const length = source.length;
  for (let i = 0; i < length; i += 1) {
    const code = source.charCodeAt(i);
    if (code === QUOTE) {
      // Skip to the closing quote; nothing inside a string is relaxed.
      for (i += 1; i < length; i += 1) {
        const inner = source.charCodeAt(i);
        if (inner === BACKSLASH) i += 1;
        else if (inner === QUOTE) break;
      }
      continue;
    }
    if (code === COMMA) {
      // Trailing-comma drop: look ahead past whitespace; if we land on `]`/`}`, swallow the comma.
      const next = peekNonWhitespace(source, i + 1);
      if (next !== -1 && isClose(source.charCodeAt(next))) {
        result += source.slice(start, i);
        start = i + 1;
      }
      continue;
    }
    if (code === OPEN_BRACE) {
      // `{{` doubled-open typo: when the next non-whitespace character is another `{`, drop THIS one
      // (the outer of the pair) — `play5.json` line 307 has `"value": {{"x":20, …}},` where the
      // matching `}}` only closes the entry + value pair, NOT the typo `{`. So eliding the typo open
      // alone leaves the close braces correctly balanced. Skipping the SECOND `{` instead (which the
      // earlier draft did via a stack) would make the relaxer also drop a real close brace later, and
      // a depth-balanced object falls out unclosed.
      const next = peekNonWhitespace(source, i + 1);
      if (next !== -1 && source.charCodeAt(next) === OPEN_BRACE) {
        result += source.slice(start, i);
        start = i + 1;
      }
      continue;
    }
    if (isClose(code)) {
      // Missing-comma insert: if the next non-whitespace character starts a new value, inject a `,`.
      const next = peekNonWhitespace(source, i + 1);
      if (next !== -1 && startsNewElementChar(source[next]!)) {
        result += `${source.slice(start, i + 1)},`;
        start = i + 1;
      }
    }
  }
  return start === 0 ? source : result + source.slice(start);
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const OPEN_BRACE = 0x7b;

function isClose(code: number): boolean {
  return code === 0x7d || code === 0x5d;
}

function peekNonWhitespace(source: string, from: number): number {
  for (let i = from; i < source.length; i += 1) {
    const c = source.charCodeAt(i);
    if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return i;
  }
  return -1;
}

function startsNewElementChar(ch: string): boolean {
  if (ch === '{' || ch === '[' || ch === '"') return true;
  // Numeric / sign starters.
  if ((ch >= '0' && ch <= '9') || ch === '-' || ch === '+') return true;
  // Bare keywords (`true`, `false`, `null`) — rarely seen in skins, but cheap to honor.
  if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) return true;
  return false;
}
