/**
 * Canonical BMS text decoding pipeline.
 *
 * This module is THE single implementation of "bytes → BMS source text" for every runtime (CLI / TUI via
 * `parseChartFile`, the web player's collection loader, and any external consumer of `@be-music/parser`). Keep all
 * encoding-detection behavior here — duplicating this flow per runtime is how charts end up decoding differently
 * between the TUI and the browser.
 *
 * Pipeline (docs/bms-spec.md「文字コード」):
 *
 * 1. BOM — UTF-8 / UTF-16LE / UTF-16BE BOMs are authoritative.
 * 2. `#CHARSET <name>` directive — scanned via a latin1 first-pass (byte-transparent), decoded with the declared
 *    encoding when it canonicalizes to a supported label.
 * 3. ASCII-only buffers decode as UTF-8 (identical for every candidate, so skip the scoring walk).
 * 4. Strict UTF-8 — a buffer that validates as UTF-8 with multibyte sequences present is UTF-8; real Shift_JIS /
 *    EUC-JP text is statistically never valid multibyte UTF-8.
 * 5. Scoring — decode with shift_jis / utf-8 / euc-jp / iso-8859-1 candidates and pick the highest-scoring text
 *    (replacement characters and control bytes penalize, BMS-shaped lines and Japanese text reward).
 *
 * Built exclusively on the WHATWG `TextDecoder` so the same code runs in Node and the browser.
 */
import { extractDeclaredBmsCharset } from './bms-charset.ts';

const OBJECT_DATA_LINE = /^#(\d{3})([0-9A-Z]{2})\s*:\s*(.+)\s*$/i;
const HEADER_LINE = /^#([A-Z][A-Z0-9_]*)(?:\s+(.+))?$/i;
const BMS_KNOWN_COMMAND_LINE =
  /^#(?:TITLE|SUBTITLE|ARTIST|GENRE|COMMENT|BPM|PLAYLEVEL|RANK|TOTAL|DIFFICULTY|STAGEFILE|BACKBMP|BANNER|PREVIEW|LNTYPE|LNMODE|LNOBJ|VOLWAV|DEFEXRANK|PLAYER|PATH_WAV|BASEBPM|STP|OPTION|WAVCMD|POORBGA|VIDEOFILE|MIDIFILE|MATERIALS|DIVIDEPROP|CHARSET|WAV[0-9A-Z]{2}|BMP[0-9A-Z]{2}|BPM[0-9A-Z]{2}|STOP[0-9A-Z]{2}|TEXT[0-9A-Z]{2}|EXRANK[0-9A-Z]{2}|ARGB[0-9A-Z]{2}|CHANGEOPTION[0-9A-Z]{2}|EXWAV[0-9A-Z]{2}|EXBMP[0-9A-Z]{2}|BGA[0-9A-Z]{2}|SCROLL[0-9A-Z]{2}|SPEED[0-9A-Z]{2}|SWBGA[0-9A-Z]{2}|RANDOM\s+\d+|SETRANDOM\s+\d+|ENDRANDOM|IF\s+\d+|ELSEIF\s+\d+|ELSE|ENDIF|SWITCH\s+\d+|SETSWITCH\s+\d+|CASE\s+\d+|DEF|SKIP|ENDSW|[0-9]{3}[0-9A-Z]{2}\s*:)/i;

export interface DecodedBmsText {
  encoding: 'utf8' | 'shift_jis' | 'euc-jp' | 'utf-16le' | 'utf-16be' | 'iso-8859-1';
  text: string;
}

export function decodeBmsText(buffer: Uint8Array): DecodedBmsText {
  if (hasUtf8Bom(buffer)) {
    return {
      encoding: 'utf8',
      text: decodeUtf8Text(buffer),
    };
  }
  if (hasUtf16LeBom(buffer)) {
    return {
      encoding: 'utf-16le',
      text: new TextDecoder('utf-16le').decode(buffer).replace(/^\ufeff/u, ''),
    };
  }
  if (hasUtf16BeBom(buffer)) {
    return {
      encoding: 'utf-16be',
      text: new TextDecoder('utf-16be').decode(buffer).replace(/^\ufeff/u, ''),
    };
  }
  // BMS spec — honor `#CHARSET <name>` at the top of the file before any automatic detection. The directive is
  // authored before any non-ASCII text, so a latin1 first-pass (every byte → its 0..255 code point) always surfaces
  // it. The web `TextDecoder` accepts the same canonical encoding names `canonicalizeBmsCharset` produces
  // (utf-8 / shift_jis / euc-jp / utf-16le / utf-16be / iso-8859-1), so we can route directly through it without an
  // intermediate library.
  const declaredCharset = extractDeclaredBmsCharset(decodeLatin1Text(buffer));
  if (declaredCharset) {
    const decoded = decodeWithDeclaredCharset(buffer, declaredCharset);
    if (decoded) return decoded;
  }
  if (isAsciiBuffer(buffer)) {
    return {
      encoding: 'utf8',
      text: decodeUtf8Text(buffer),
    };
  }
  // A buffer that strictly validates as UTF-8 while containing multibyte sequences is UTF-8: legacy Japanese
  // encodings essentially never produce byte streams that survive a fatal UTF-8 decode. This catches the common
  // modern case (BOM-less UTF-8 charts) that the relative-scoring walk below can misattribute to shift_jis when the
  // non-ASCII payload is short.
  const strictUtf8 = tryDecodeStrictUtf8(buffer);
  if (strictUtf8 !== undefined) {
    return {
      encoding: 'utf8',
      text: strictUtf8,
    };
  }
  return decodeByScoring(buffer);
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

function decodeByScoring(buffer: Uint8Array): DecodedBmsText {
  const candidates: Array<{ encoding: DecodedBmsText['encoding']; label: string; bias: number }> = [
    { encoding: 'shift_jis', label: 'shift_jis', bias: 5 },
    { encoding: 'utf8', label: 'utf-8', bias: 4 },
    { encoding: 'euc-jp', label: 'euc-jp', bias: 3 },
    { encoding: 'iso-8859-1', label: 'iso-8859-1', bias: -5 },
  ];

  let best: DecodedBmsText | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    let text: string;
    try {
      text = new TextDecoder(candidate.label).decode(buffer);
    } catch {
      continue;
    }
    const score = scoreDecodedBmsText(text, candidate.bias);
    if (score > bestScore) {
      bestScore = score;
      best = {
        encoding: candidate.encoding,
        text,
      };
    }
  }

  return (
    best ?? {
      encoding: 'utf8',
      text: decodeUtf8Text(buffer),
    }
  );
}

function scoreDecodedBmsText(text: string, bias: number): number {
  let score = bias;
  if (text.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const textStats = collectTextStatistics(text);
  score -= textStats.replacementCount * 120;
  score -= textStats.nullCount * 80;
  score -= textStats.lowControlCount * 8;

  const lines = text.split(/\r?\n/);
  let hashLines = 0;
  let objectLines = 0;
  let headerLines = 0;
  let knownCommandLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('#')) {
      continue;
    }

    hashLines += 1;
    if (OBJECT_DATA_LINE.test(trimmed)) {
      objectLines += 1;
    } else if (HEADER_LINE.test(trimmed)) {
      headerLines += 1;
    }
    if (BMS_KNOWN_COMMAND_LINE.test(trimmed)) {
      knownCommandLines += 1;
    }
  }

  score += hashLines * 0.4;
  score += objectLines * 14;
  score += headerLines * 8;
  score += knownCommandLines * 3;

  const printableRatio = textStats.printableCount / Math.max(1, text.length);
  score += printableRatio * 20;

  score += Math.min(40, textStats.japaneseCount * 0.02);

  return score;
}

function collectTextStatistics(text: string): {
  replacementCount: number;
  nullCount: number;
  lowControlCount: number;
  printableCount: number;
  japaneseCount: number;
} {
  let replacementCount = 0;
  let nullCount = 0;
  let lowControlCount = 0;
  let printableCount = 0;
  let japaneseCount = 0;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0xfffd) {
      replacementCount += 1;
    }
    if (code === 0x0000) {
      nullCount += 1;
    }
    if (
      (code >= 0x0001 && code <= 0x0008) ||
      (code >= 0x000b && code <= 0x000c) ||
      (code >= 0x000e && code <= 0x001f)
    ) {
      lowControlCount += 1;
    }
    if (
      code === 0x000a ||
      code === 0x000d ||
      code === 0x0009 ||
      (code >= 0x0020 && code <= 0x007e) ||
      (code >= 0x00a0 && code <= 0x00ff) ||
      (code >= 0x3000 && code <= 0x30ff) ||
      (code >= 0x3400 && code <= 0x9fff)
    ) {
      printableCount += 1;
    }
    if ((code >= 0x3040 && code <= 0x30ff) || (code >= 0x3400 && code <= 0x9fff)) {
      japaneseCount += 1;
    }
  }

  return {
    replacementCount,
    nullCount,
    lowControlCount,
    printableCount,
    japaneseCount,
  };
}

function tryDecodeStrictUtf8(buffer: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return undefined;
  }
}

export function decodeUtf8Text(buffer: Uint8Array): string {
  return new TextDecoder('utf-8').decode(buffer).replace(/^\ufeff/u, '');
}

function hasUtf8Bom(buffer: Uint8Array): boolean {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
}

function hasUtf16LeBom(buffer: Uint8Array): boolean {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe;
}

function hasUtf16BeBom(buffer: Uint8Array): boolean {
  return buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff;
}

function isAsciiBuffer(buffer: Uint8Array): boolean {
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index]! >= 0x80) {
      return false;
    }
  }
  return true;
}
