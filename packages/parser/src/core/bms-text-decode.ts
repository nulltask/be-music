/**
 * Canonical BMS text decoding pipeline.
 *
 * This module is THE single implementation of "bytes → BMS source text" for every runtime (CLI / TUI via
 * `parseChartFile`, the web player's collection loader, and any external consumer of `@be-music/parser`). Keep all
 * encoding-detection behavior here — duplicating this flow per runtime is how charts end up decoding differently
 * between the TUI and the browser.
 *
 * Current pipeline: UTF-8 BOM → `#CHARSET` directive → shift_jis fallback. Built exclusively on the WHATWG
 * `TextDecoder` so the same code runs in Node and the browser.
 */
import { extractDeclaredBmsCharset } from './bms-charset.ts';

export interface DecodedBmsText {
  encoding: 'utf8' | 'shift_jis' | 'euc-jp' | 'utf-16le' | 'utf-16be' | 'iso-8859-1';
  text: string;
}

export function decodeBmsText(buffer: Uint8Array): DecodedBmsText {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      encoding: 'utf8',
      text: decodeUtf8Text(buffer),
    };
  }
  // BMS spec — honor `#CHARSET <name>` at the top of the file before falling back to the shift_jis default. The
  // directive is authored before any non-ASCII text, so a latin1 first-pass (every byte → its 0..255 code point) always
  // surfaces it. The web `TextDecoder` accepts the same canonical encoding names `canonicalizeBmsCharset` produces
  // (utf-8 / shift_jis / euc-jp / utf-16le / utf-16be / iso-8859-1), so we can route directly through it without an
  // intermediate library.
  const declaredCharset = extractDeclaredBmsCharset(decodeLatin1Text(buffer));
  if (declaredCharset) {
    const decoded = decodeWithDeclaredCharset(buffer, declaredCharset);
    if (decoded) return decoded;
  }
  try {
    return {
      encoding: 'shift_jis',
      text: new TextDecoder('shift_jis').decode(buffer),
    };
  } catch {
    return {
      encoding: 'utf8',
      text: decodeUtf8Text(buffer),
    };
  }
}

function decodeLatin1Text(buffer: Uint8Array): string {
  // `iso-8859-1` is required by the WHATWG Encoding spec, so every browser and Node ships it. Maps every byte 1:1 to a
  // Unicode code point in [0, 255], which lets the `#CHARSET` scan look at the file's bytes without misinterpretation
  // regardless of the actual encoding.
  return new TextDecoder('iso-8859-1').decode(buffer);
}

function decodeWithDeclaredCharset(buffer: Uint8Array, charset: string): DecodedBmsText | undefined {
  // BMS `#CHARSET` declares the encoding for the file. We map the canonicalized name onto a `TextDecoder` label and
  // strip a leading BOM where applicable. `TextDecoder` throws synchronously for unrecognized labels, which we treat as
  // "fall back to autodetection" — same as a value that didn't canonicalize.
  try {
    switch (charset) {
      case 'utf-8':
        return { encoding: 'utf8', text: decodeUtf8Text(buffer) };
      case 'shift_jis':
        return { encoding: 'shift_jis', text: new TextDecoder('shift_jis').decode(buffer) };
      case 'euc-jp':
        return { encoding: 'euc-jp', text: new TextDecoder('euc-jp').decode(buffer) };
      case 'utf-16le':
        return { encoding: 'utf-16le', text: new TextDecoder('utf-16le').decode(buffer).replace(/^\ufeff/u, '') };
      case 'utf-16be':
        return { encoding: 'utf-16be', text: new TextDecoder('utf-16be').decode(buffer).replace(/^\ufeff/u, '') };
      case 'iso-8859-1':
        return { encoding: 'iso-8859-1', text: new TextDecoder('iso-8859-1').decode(buffer) };
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

export function decodeUtf8Text(buffer: Uint8Array): string {
  return new TextDecoder('utf-8').decode(buffer).replace(/^\ufeff/u, '');
}
