import type { BeMusicJSON } from '@be-music/chart-source';
import { decodeBMSText } from './bms-text-decode.ts';
import { parseBMS } from './parser.ts';

/** Parse BMS bytes and retain filename byte prefixes needed by LR2's EXTRA sound families. */
export function parseBMSBytes(bytes: Uint8Array): BeMusicJSON {
  const decoded = decodeBMSText(bytes);
  const chart = parseBMS(decoded.text);
  // LR2's byte-oriented loader does not read UTF-16 BMS. Never manufacture its
  // two-byte filename identity from a decoded Unicode spelling.
  if (decoded.encoding === 'utf-16le' || decoded.encoding === 'utf-16be') return chart;
  const decoder = new TextDecoder(decoded.encoding === 'utf8' ? 'utf-8' : decoded.encoding);
  const prefixes = new Map<string, string>();
  let start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  for (let end = start; end <= bytes.length; end++) {
    if (end < bytes.length && bytes[end] !== 10 && bytes[end] !== 13) continue;
    const line = bytes.subarray(start, end);
    const wav =
      line[0] === 35 && ((line[1] ?? 0) | 32) === 119 && ((line[2] ?? 0) | 32) === 97 && ((line[3] ?? 0) | 32) === 118;
    const match = wav ? /^#WAV[0-9A-Z]{2} (.+)$/i.exec(decoder.decode(line)) : undefined;
    if (match) {
      const prefix = [...line.subarray(7, 9)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      if (prefix) prefixes.set(match[1]!.trim(), prefix);
    }
    if (bytes[end] === 13 && bytes[end + 1] === 10) end++;
    start = end + 1;
  }
  if (prefixes.size > 0) chart.bms.wavNameBytePrefixes = Object.fromEntries(prefixes);
  return chart;
}
