/**
 * Shared `#CHARSET` directive helpers.
 *
 * BMS spec — `#CHARSET <name>` declares the chart's text encoding. The directive is authored at the top of the file
 * before any non-ASCII text so consumers can decode the rest of the chart with the declared encoding. The two helpers
 * here are pure string logic (no Buffer / Node dependency) so the CLI / TUI buffer decoder and the web player's
 * `TextDecoder`-based loader can both honor the directive via a single canonical implementation.
 */

/**
 * Canonical charset name accepted by both `iconv-lite` and the browser's `TextDecoder`. Returns `undefined` for empty /
 * unknown encodings so the caller can fall back to its automatic detection path.
 *
 * Real-world BMS / BME files use a small set of variants for each encoding (`UTF-8` / `utf8`, `Shift_JIS` / `Shift-JIS`
 * / `sjis` / `MS932` / `cp932`, …). The normalization strips separators and lower-cases so every common spelling
 * collapses onto one canonical name.
 */
export function canonicalizeBmsCharset(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.length === 0) return undefined;
  switch (normalized) {
    case 'utf8':
    case 'utf':
      return 'utf-8';
    case 'utf16':
    case 'utf16le':
      return 'utf-16le';
    case 'utf16be':
      return 'utf-16be';
    case 'shiftjis':
    case 'sjis':
    case 'cp932':
    case 'ms932':
    case 'windows31j':
    case 'csshiftjis':
      return 'shift_jis';
    case 'eucjp':
    case 'cseucpkdfmtjapanese':
      return 'euc-jp';
    case 'iso88591':
    case 'latin1':
    case 'cp1252':
    case 'windows1252':
      return 'iso-8859-1';
    default:
      return undefined;
  }
}

/**
 * Scans the head of a (latin1- or ASCII-decoded) BMS source for a `#CHARSET <name>` directive and returns the canonical
 * encoding name, or `undefined` when no directive is found.
 *
 * Per hitkey BMS Memo's `#CHARSET` section, the directive is authored at the top of the file before any non-ASCII text
 * so a latin1 first-pass decode (which preserves bytes 1:1) always lets us read it. Looking at only the first ~4 KB
 * keeps the scan cheap and avoids regex-walking a multi-MB chart needlessly.
 */
export function extractDeclaredBmsCharset(text: string): string | undefined {
  const head = text.length > 4096 ? text.slice(0, 4096) : text;
  for (const line of head.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('#')) continue;
    const match = /^#CHARSET\s+(\S+)/i.exec(trimmed);
    if (match) {
      return canonicalizeBmsCharset(match[1]);
    }
  }
  return undefined;
}
