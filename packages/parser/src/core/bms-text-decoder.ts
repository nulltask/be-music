import iconv from 'iconv-lite';

const OBJECT_DATA_LINE = /^#(\d{3})([0-9A-Z]{2})\s*:\s*(.+)\s*$/i;
const HEADER_LINE = /^#([A-Z][A-Z0-9_]*)(?:\s+(.+))?$/i;
const BMS_KNOWN_COMMAND_LINE =
  /^#(?:TITLE|SUBTITLE|ARTIST|GENRE|COMMENT|BPM|PLAYLEVEL|RANK|TOTAL|DIFFICULTY|STAGEFILE|PREVIEW|LNTYPE|LNMODE|LNOBJ|VOLWAV|DEFEXRANK|PLAYER|PATH_WAV|BASEBPM|STP|OPTION|WAVCMD|POORBGA|VIDEOFILE|MATERIALS|DIVIDEPROP|CHARSET|WAV[0-9A-Z]{2}|BMP[0-9A-Z]{2}|BPM[0-9A-Z]{2}|STOP[0-9A-Z]{2}|TEXT[0-9A-Z]{2}|EXRANK[0-9A-Z]{2}|ARGB[0-9A-Z]{2}|CHANGEOPTION[0-9A-Z]{2}|EXWAV[0-9A-Z]{2}|EXBMP[0-9A-Z]{2}|BGA[0-9A-Z]{2}|SCROLL[0-9A-Z]{2}|SWBGA[0-9A-Z]{2}|RANDOM\s+\d+|SETRANDOM\s+\d+|ENDRANDOM|IF\s+\d+|ELSEIF\s+\d+|ELSE|ENDIF|SWITCH\s+\d+|SETSWITCH\s+\d+|CASE\s+\d+|DEF|SKIP|ENDSW|[0-9]{3}[0-9A-Z]{2}\s*:)/i;

type DetectedBmsEncoding = 'utf8' | 'shift_jis' | 'euc-jp' | 'latin1' | 'utf16le' | 'utf16be';

export interface DecodedBmsText {
  encoding: DetectedBmsEncoding;
  text: string;
}

export function decodeBmsText(buffer: Buffer): DecodedBmsText {
  if (hasUtf8Bom(buffer)) {
    return {
      encoding: 'utf8',
      text: decodeUtf8Text(buffer),
    };
  }
  if (hasUtf16LeBom(buffer)) {
    return {
      encoding: 'utf16le',
      text: decodeUtf16LeText(buffer),
    };
  }
  if (hasUtf16BeBom(buffer)) {
    return {
      encoding: 'utf16be',
      text: decodeUtf16BeText(buffer),
    };
  }

  const candidates: Array<{ encoding: DetectedBmsEncoding; bias: number }> = [
    { encoding: 'shift_jis', bias: 5 },
    { encoding: 'utf8', bias: 4 },
    { encoding: 'euc-jp', bias: 3 },
    { encoding: 'latin1', bias: -5 },
  ];

  let best: DecodedBmsText | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const text = iconv.decode(buffer, candidate.encoding);
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

export function decodeUtf8Text(buffer: Buffer): string {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text;
}

function decodeUtf16LeText(buffer: Buffer): string {
  const offset = hasUtf16LeBom(buffer) ? 2 : 0;
  return buffer.subarray(offset).toString('utf16le');
}

function decodeUtf16BeText(buffer: Buffer): string {
  const offset = hasUtf16BeBom(buffer) ? 2 : 0;
  const source = buffer.subarray(offset);
  const evenLength = source.length - (source.length % 2);
  const swapped = Buffer.allocUnsafe(evenLength);

  for (let index = 0; index < evenLength; index += 2) {
    swapped[index] = source[index + 1];
    swapped[index + 1] = source[index];
  }
  return swapped.toString('utf16le');
}

function hasUtf8Bom(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
}

function hasUtf16LeBom(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe;
}

function hasUtf16BeBom(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff;
}
