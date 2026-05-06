// JSON skin parsing.
//
// beatoraja `.json` skins use JSON5-style trailing commas in places (the reference theme's `play5.json` ends an
// `item` array with `,]`). We strip trailing commas before handing the text to `JSON.parse` so authors don't have to
// worry about that gotcha.

import type { BeatorajaSkin, BeatorajaSkinHeader } from './beatoraja-skin-types.ts';

/**
 * Parse a beatoraja JSON skin file into a typed tree. Throws on syntax errors; callers wrap that into their own
 * load-failure surface (consistent with the Lua evaluator's Result-typed error).
 */
export function parseBeatorajaSkinJson(source: Uint8Array | string): BeatorajaSkin {
  const text = typeof source === 'string' ? source : new TextDecoder('utf-8').decode(source);
  const sanitized = relaxBeatorajaJson(text);
  const parsed = JSON.parse(sanitized) as Record<string, unknown>;
  return parsed as BeatorajaSkin;
}

/**
 * Read just the header section without parsing the (potentially large) element arrays. We currently parse the whole
 * tree because beatoraja JSON skins are ≤ a few hundred KB and `JSON.parse` is much faster than a hand-rolled
 * partial tokenizer; the field exists to stay symmetric with the Lua side, where `parseBeatorajaSkinHeader` is the
 * cheap path that avoids running `main()`.
 */
export function parseBeatorajaSkinJsonHeader(source: Uint8Array | string): BeatorajaSkinHeader {
  const skin = parseBeatorajaSkinJson(source);
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
  return header;
}

/**
 * Relax a beatoraja JSON skin source into something `JSON.parse` will accept. The reference theme's `play*.json`
 * deviates from RFC 8259 in two ways:
 *
 * 1. **Trailing commas** before `]` / `}` (e.g. `play5.json`'s property item array ends with `…},]`).
 * 2. **Missing commas** between adjacent objects or arrays — `}\n\t{` is accepted by beatoraja's parser as if a `,`
 *    had been written. This shows up in `play24.json` line 715 (`{...]}\n\t{...}` between `#15` and `notes`).
 *
 * We fix both by walking the source character-by-character with a tiny state machine that tracks string boundaries.
 *
 * Comments and unquoted keys are NOT supported — none of the bundled skins use those, and `JSON.parse` will reject
 * them with a clear error if a community theme tries.
 */
export function relaxBeatorajaJson(source: string): string {
  let result = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      result += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }
    if (ch === ',') {
      // Trailing-comma drop: look ahead past whitespace; if we land on `]`/`}`, swallow the comma.
      const next = peekNonWhitespace(source, i + 1);
      if (next !== -1 && (source[next] === ']' || source[next] === '}')) {
        continue;
      }
      result += ch;
      continue;
    }
    if (ch === '}' || ch === ']') {
      result += ch;
      // Missing-comma insert: if the next non-whitespace character starts a new value (`{`, `[`, `"`, digit, sign,
      // or letter — covering identifiers like `true` even though we don't write them in skins), inject a `,`.
      const next = peekNonWhitespace(source, i + 1);
      if (next !== -1 && startsNewElementChar(source[next])) {
        result += ',';
      }
      continue;
    }
    result += ch;
  }
  return result;
}

function peekNonWhitespace(source: string, from: number): number {
  for (let i = from; i < source.length; i += 1) {
    const c = source[i];
    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') return i;
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

/**
 * @deprecated Use {@link relaxBeatorajaJson}. Kept as a re-export so older code paths keep building, but the new
 * helper handles BOTH trailing-comma drop AND missing-comma insertion.
 */
export const stripTrailingCommas = relaxBeatorajaJson;
