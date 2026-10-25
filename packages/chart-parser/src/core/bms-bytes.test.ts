import { expect, test } from 'vite-plus/test';
import { cloneJSON } from '@be-music/chart-source';
import { parseBMSBytes, parseChart, resolveBMSControlFlowWithDraws } from '../index.ts';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

test('byte parsing retains exact CP932 filename prefixes rather than two Unicode characters', () => {
  const bytes = new Uint8Array([
    ...utf8('#TITLE Prefix\r\n#WAV01 '),
    0x82,
    0xa0,
    0x82,
    0xa2,
    ...utf8('.wav\r\n#WAV02 '),
    0x82,
    0xa0,
    0x82,
    0xa4,
    ...utf8('.ogg\r\n#00111:01'),
  ]);
  const chart = parseBMSBytes(bytes);
  expect(chart.resources.wav).toEqual({ '01': 'あい.wav', '02': 'あう.ogg' });
  expect(chart.bms.wavNameBytePrefixes).toEqual({ 'あい.wav': '82a0', 'あう.ogg': '82a0' });
  expect(chart.events[0]!.channel).toBe('11');
});

test('UTF-8 retains its actual first two bytes, including an incomplete multibyte character', () => {
  const chart = parseBMSBytes(utf8('\ufeff#WAV01 あい.wav\n#WAV02 ab.wav\n'));
  expect(chart.bms.wavNameBytePrefixes).toEqual({ 'あい.wav': 'e381', 'ab.wav': '6162' });
});

test('CR, LF and CRLF preserve paths, a one-byte filename, lowercase headers and subarray offsets', () => {
  const bytes = utf8('xx#WAV01 a\r#WAV02 bc.wav\n#wav03 de.wav\r\n#00111:01zz');
  const chart = parseBMSBytes(bytes.subarray(2, bytes.length - 2));
  expect(chart.bms.wavNameBytePrefixes).toEqual({ a: '61', 'bc.wav': '6263', 'de.wav': '6465' });
});

test('UTF-16 does not manufacture an original byte-oriented LR2 filename', () => {
  const text = '#WAV01 ab.wav';
  const bytes = new Uint8Array([255, 254, ...Array.from(text).flatMap((character) => [character.charCodeAt(0), 0])]);
  expect(parseBMSBytes(bytes).resources.wav['01']).toBe('ab.wav');
  expect(parseBMSBytes(bytes).bms.wavNameBytePrefixes).toBeUndefined();
});

test('cloning, JSON round trips and selected control-flow resources retain independent original prefixes', () => {
  const chart = parseBMSBytes(utf8('#RANDOM 2\n#IF 1\n#WAV01 aa.wav\n#ELSE\n#WAV01 bb.wav\n#ENDIF\n#ENDRANDOM'));
  const copied = cloneJSON(chart);
  copied.bms.wavNameBytePrefixes!['aa.wav'] = 'ffff';
  expect(chart.bms.wavNameBytePrefixes!['aa.wav']).toBe('6161');
  const parsed = parseChart(JSON.stringify(chart), 'json');
  expect(parsed.bms.wavNameBytePrefixes).toEqual(chart.bms.wavNameBytePrefixes);
  for (const [draw, path] of [
    [1, 'aa.wav'],
    [2, 'bb.wav'],
  ] as const) {
    const resolved = resolveBMSControlFlowWithDraws(parsed, [{ command: 'RANDOM', range: 2, value: draw }]);
    expect(resolved.resources.wav['01']).toBe(path);
    expect(resolved.bms.wavNameBytePrefixes![path]).toBe(draw === 1 ? '6161' : '6262');
  }
});

test('JSON normalization validates byte prefixes without accepting arbitrary values', () => {
  const chart = parseBMSBytes(utf8('#WAV01 aa.wav'));
  const raw = {
    ...chart,
    bms: { ...chart.bms, wavNameBytePrefixes: { 'aa.wav': 'AABB', a: 'aa', b: '', c: 'abc', d: 1, e: 'aabbcc' } },
  };
  expect(parseChart(JSON.stringify(raw), 'json').bms.wavNameBytePrefixes).toEqual({ 'aa.wav': 'aabb', a: 'aa' });
});
