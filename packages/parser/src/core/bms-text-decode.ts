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
 * 5. Korean EUC-KR — a buffer whose every non-ASCII byte pairs up as KS X 1001 (`0xA1`–`0xFE` twice) and decodes to
 *    Hangul syllables is EUC-KR. beatoraja probes EUC-KR before MS932 the same way; Japanese Shift_JIS text has lead
 *    or trail bytes outside that range almost always.
 * 6. Scoring — decode with shift_jis / utf-8 / euc-jp / iso-8859-1 candidates and pick the highest-scoring text
 *    (replacement characters and control bytes penalize, BMS-shaped lines and Japanese text reward).
 *
 * Built exclusively on the WHATWG `TextDecoder` so the same code runs in Node and the browser.
 */
import { extractDeclaredBmsCharset } from './bms-charset.ts';

const OBJECT_DATA_LINE = /^#(\d{3})([0-9A-Z]{2})\s*:\s*(.+)\s*$/i;
const HEADER_LINE = /^#([A-Z][A-Z0-9_]*)(?:\s+(.+))?$/i;
const BMS_KNOWN_COMMAND_LINE =
  /^#(?:TITLE|SUBTITLE|ARTIST|GENRE|COMMENT|BPM|PLAYLEVEL|RANK|TOTAL|DIFFICULTY|STAGEFILE|BACKBMP|BANNER|PREVIEW|LNTYPE|LNMODE|LNOBJ|VOLWAV|DEFEXRANK|PLAYER|PATH_WAV|BASEBPM|STP|OPTION|WAVCMD|POORBGA|VIDEOFILE|MIDIFILE|MATERIALS|DIVIDEPROP|CHARSET|WAV[0-9A-Z]{2}|BMP[0-9A-Z]{2}|BPM[0-9A-Z]{2}|STOP[0-9A-Z]{2}|TEXT[0-9A-Z]{2}|EXRANK[0-9A-Z]{2}|ARGB[0-9A-Z]{2}|CHANGEOPTION[0-9A-Z]{2}|EXWAV[0-9A-Z]{2}|EXBMP[0-9A-Z]{2}|BGA[0-9A-Z]{2}|SCROLL[0-9A-Z]{2}|SPEED[0-9A-Z]{2}|SWBGA[0-9A-Z]{2}|RANDOM\s+\d+|SETRANDOM\s+\d+|ENDRANDOM|IF\s+\d+|ELSEIF\s+\d+|ELSE|ENDIF|SWITCH\s+\d+|SETSWITCH\s+\d+|CASE\s+\d+|DEF|SKIP|ENDSW|[0-9]{3}[0-9A-Z]{2}\s*:)/i;

/** How much of the file the `#CHARSET` scan reads: `extractDeclaredBmsCharset` looks at the first 4 KB only. */
const CHARSET_SCAN_BYTES = 4096;

export interface DecodedBmsText {
  encoding: 'utf8' | 'shift_jis' | 'euc-jp' | 'euc-kr' | 'utf-16le' | 'utf-16be' | 'iso-8859-1';
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
  const declaredCharset = extractDeclaredBmsCharset(decodeLatin1Text(buffer.subarray(0, CHARSET_SCAN_BYTES)));
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
  const eucKr = tryDecodeKoreanEucKr(buffer);
  if (eucKr !== undefined) {
    return {
      encoding: 'euc-kr',
      text: eucKr,
    };
  }
  return decodeByScoring(buffer);
}

/** Share of the non-ASCII characters that must be Hangul syllables before a KS X 1001-shaped buffer counts as Korean. */
const KOREAN_HANGUL_SHARE = 0.9;

/**
 * Decodes `buffer` as EUC-KR when it looks like Korean text: every byte `>= 0x80` pairs up as a KS X 1001 character
 * (lead and trail both `0xA1`–`0xFE`), as beatoraja's EUC-KR round-trip probe requires, and at least
 * {@link KOREAN_HANGUL_SHARE} of the decoded non-ASCII characters are Hangul syllables. The share keeps out Shift_JIS
 * half-width katakana, whose byte pairs also fit KS X 1001 but land on symbols and Hanja as often as on Hangul.
 */
function tryDecodeKoreanEucKr(buffer: Uint8Array): string | undefined {
  let index = 0;
  while (index < buffer.length) {
    const lead = buffer[index]!;
    if (lead < 0x80) {
      index += 1;
      continue;
    }
    const trail = buffer[index + 1];
    if (lead < 0xa1 || lead > 0xfe || trail === undefined || trail < 0xa1 || trail > 0xfe) {
      return undefined;
    }
    index += 2;
  }
  let text: string;
  try {
    text = new TextDecoder('euc-kr', { fatal: true }).decode(buffer);
  } catch {
    return undefined;
  }
  let nonAscii = 0;
  let hangul = 0;
  for (let position = 0; position < text.length; position += 1) {
    const code = text.charCodeAt(position);
    if (code < 0x80) continue;
    nonAscii += 1;
    if (code >= 0xac00 && code <= 0xd7a3) {
      hangul += 1;
    }
  }
  return nonAscii > 0 && hangul >= nonAscii * KOREAN_HANGUL_SHARE ? text : undefined;
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
      case 'euc-kr':
        return { encoding: 'euc-kr', text: new TextDecoder('euc-kr').decode(buffer) };
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

const SCORING_CANDIDATES: ReadonlyArray<{ encoding: DecodedBmsText['encoding']; label: string; bias: number }> = [
  { encoding: 'shift_jis', label: 'shift_jis', bias: 5 },
  { encoding: 'utf8', label: 'utf-8', bias: 4 },
  { encoding: 'euc-jp', label: 'euc-jp', bias: 3 },
  { encoding: 'iso-8859-1', label: 'iso-8859-1', bias: -5 },
];

/** What a text's score is made of: character and line counts, summed over any split of the text into lines. */
interface ScoreCounts {
  length: number;
  replacementCount: number;
  nullCount: number;
  lowControlCount: number;
  printableCount: number;
  japaneseCount: number;
  hashLines: number;
  objectLines: number;
  headerLines: number;
  knownCommandLines: number;
}

function emptyScoreCounts(): ScoreCounts {
  return {
    length: 0,
    replacementCount: 0,
    nullCount: 0,
    lowControlCount: 0,
    printableCount: 0,
    japaneseCount: 0,
    hashLines: 0,
    objectLines: 0,
    headerLines: 0,
    knownCommandLines: 0,
  };
}

/**
 * Picks the candidate encoding whose decoded text scores highest. Every candidate decodes a byte below `0x80` to the
 * same character and never swallows one into a multibyte sequence, and a line feed ends any pending sequence, so a
 * line made only of ASCII bytes reads the same under all of them: those lines are counted once, and only the lines
 * holding a byte `>= 0x80` are decoded and counted per candidate. The counts are integers summed exactly, and the score
 * is formed from them in the same order as before, so the choice is the one a whole-text pass would make.
 */
function decodeByScoring(buffer: Uint8Array): DecodedBmsText {
  // Latin-1 maps each byte to the code point of the same value, so an ASCII line reads straight out of it.
  const latin1 = decodeLatin1Text(buffer);
  const shared = emptyScoreCounts();
  const mixedLines: Uint8Array[] = [];
  let lineStart = 0;
  let lineHasHighByte = false;
  const endLine = (end: number): void => {
    if (lineHasHighByte) {
      mixedLines.push(buffer.subarray(lineStart, end));
    } else {
      countScoredLine(shared, latin1.slice(lineStart, end));
    }
  };
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index]!;
    if (byte === 0x0a) {
      endLine(index);
      // The line feed itself: one printable character in every candidate's text.
      shared.length += 1;
      shared.printableCount += 1;
      lineStart = index + 1;
      lineHasHighByte = false;
    } else if (byte >= 0x80) {
      lineHasHighByte = true;
    }
  }
  endLine(buffer.length);

  // The mixed lines, rejoined with line feeds: decoding them in one call reads each line as the whole text does.
  let mixedLength = 0;
  for (const line of mixedLines) {
    mixedLength += line.length;
  }
  const mixed = new Uint8Array(mixedLength + Math.max(0, mixedLines.length - 1));
  let offset = 0;
  for (const [index, line] of mixedLines.entries()) {
    if (index > 0) {
      mixed[offset] = 0x0a;
      offset += 1;
    }
    mixed.set(line, offset);
    offset += line.length;
  }

  let best: { encoding: DecodedBmsText['encoding']; label: string } | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of SCORING_CANDIDATES) {
    let decoded: string;
    try {
      // `ignoreBOM`: a BOM-looking sequence that starts a mixed line is not at the start of the file.
      decoded = new TextDecoder(candidate.label, { ignoreBOM: true }).decode(mixed);
    } catch {
      continue;
    }
    const counts = { ...shared };
    for (const line of decoded.split('\n')) {
      countScoredLine(counts, line);
    }
    // The line feeds that rejoined the mixed lines are not in the file.
    const joins = Math.max(0, mixedLines.length - 1);
    counts.length -= joins;
    counts.printableCount -= joins;
    const score = scoreCounts(counts, candidate.bias);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (best === undefined) {
    return { encoding: 'utf8', text: decodeUtf8Text(buffer) };
  }
  return { encoding: best.encoding, text: new TextDecoder(best.label).decode(buffer) };
}

/** Adds one line (without its line feed) to `counts`: its characters, and how BMS-shaped it is. */
function countScoredLine(counts: ScoreCounts, line: string): void {
  counts.length += line.length;
  for (let index = 0; index < line.length; index += 1) {
    const code = line.charCodeAt(index);
    if (code === 0xfffd) {
      counts.replacementCount += 1;
    }
    if (code === 0x0000) {
      counts.nullCount += 1;
    }
    if (
      (code >= 0x0001 && code <= 0x0008) ||
      (code >= 0x000b && code <= 0x000c) ||
      (code >= 0x000e && code <= 0x001f)
    ) {
      counts.lowControlCount += 1;
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
      counts.printableCount += 1;
    }
    if ((code >= 0x3040 && code <= 0x30ff) || (code >= 0x3400 && code <= 0x9fff)) {
      counts.japaneseCount += 1;
    }
  }

  const trimmed = line.trim();
  if (!trimmed.startsWith('#')) {
    return;
  }
  counts.hashLines += 1;
  if (OBJECT_DATA_LINE.test(trimmed)) {
    counts.objectLines += 1;
  } else if (HEADER_LINE.test(trimmed)) {
    counts.headerLines += 1;
  }
  if (BMS_KNOWN_COMMAND_LINE.test(trimmed)) {
    counts.knownCommandLines += 1;
  }
}

function scoreCounts(counts: ScoreCounts, bias: number): number {
  let score = bias;
  if (counts.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  score -= counts.replacementCount * 120;
  score -= counts.nullCount * 80;
  score -= counts.lowControlCount * 8;

  score += counts.hashLines * 0.4;
  score += counts.objectLines * 14;
  score += counts.headerLines * 8;
  score += counts.knownCommandLines * 3;

  const printableRatio = counts.printableCount / Math.max(1, counts.length);
  score += printableRatio * 20;

  score += Math.min(40, counts.japaneseCount * 0.02);

  return score;
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
