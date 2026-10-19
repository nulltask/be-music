/**
 * Golden corpus of the Be-Music Fingerprint (`docs/fingerprint-spec.md` section 5). These values pin `bmfp0`, the
 * development version, so a change that alters any of them is deliberate and visible in review. From the first stable
 * version (`bmfp1`) on, such a change alters the document of an existing chart and needs a new algorithm version, not an
 * update of the expected value.
 */
import { describe, expect, test } from 'vite-plus/test';
import { parseBMS, parseBmson, resolveBMSControlFlowWithDraws } from '../../parser/src/index.ts';
import { computeChartFingerprint, computePlayFingerprint } from './index.ts';

const SP7 = [
  '#PLAYER 1',
  '#TITLE golden 7K',
  '#BPM 150',
  '#RANK 2',
  '#TOTAL 287.5',
  '#LNOBJ ZZ',
  '#LNMODE 2',
  '#BPM01 133.333333',
  '#STOP01 48',
  '#SCROLL01 0.5',
  '#SPEED01 1',
  '#SPEED02 1.5',
  '#EXRANK01 75',
  '#STP 004.500 120',
  '#WAV01 kick.wav',
  '#WAVZZ end.wav',
  '#00102:0.75',
  '#00111:01010101',
  '#00112:00010001',
  '#00116:01000000',
  '#00118:0000000001000000',
  '#00119:000001',
  '#00211:0100ZZ00',
  '#00256:01000100',
  '#002D3:0A',
  '#00308:01',
  '#00309:0001',
  '#003SC:01',
  '#003SP:0102',
  '#003A0:01',
  '#00311:01020304',
  '#00317:01',
  '#00412:010101',
  '#00413:0000000000000001',
].join('\n');

const BMSON = JSON.stringify({
  version: '1.0.0',
  info: { title: 'golden bmson', init_bpm: 160, mode_hint: 'beat-7k', resolution: 240, judge_rank: 100, ln_type: 2 },
  lines: [{ y: 0 }, { y: 960 }, { y: 1680 }, { y: 2640 }],
  sound_channels: [
    {
      name: 'piano.wav',
      notes: [
        { x: 1, y: 960, l: 0, c: false },
        { x: 2, y: 1200, l: 240, c: false },
        { x: 3, y: 1680, l: 0, c: false, t: 3 },
        { x: 8, y: 2160, l: 0, c: false },
      ],
    },
  ],
  mine_channels: [
    {
      name: 'mine.wav',
      notes: [
        { x: 4, y: 1440, damage: 12 },
        { x: 5, y: 1440 },
      ],
    },
  ],
  bpm_events: [{ y: 1680, bpm: 320 }],
  stop_events: [{ y: 2400, duration: 120 }],
});

const PMS = [
  '#PLAYER 1',
  '#BPM 140',
  '#00111:01',
  '#00112:0001',
  '#00113:01',
  '#00114:0001',
  '#00115:01',
  '#00122:01',
  '#00123:0001',
  '#00124:01',
  '#00125:0001',
].join('\n');

const DP = [
  '#PLAYER 3',
  '#BPM 175',
  '#DEFEXRANK 120',
  '#00111:01',
  '#00116:0001',
  '#00118:01',
  '#00121:0001',
  '#00226:01',
  '#00229:0001',
  '#00227:01',
].join('\n');

const RANDOM = [
  '#PLAYER 1',
  '#BPM 150',
  '#LNOBJ ZZ',
  '#BPM01 200',
  '#00111:0101',
  '#00208:01',
  '#RANDOM 3',
  '#IF 1',
  '#00212:01ZZ',
  '#ELSEIF 2',
  '#BPM01 250',
  '#00213:01',
  '#ELSE',
  '#SWITCH 2',
  '#CASE 1',
  '#00314:01',
  '#DEF',
  '#00315:01',
  '#ENDSW',
  '#ENDIF',
  '#ENDRANDOM',
  '#RANDOM 2',
  '#IF 1',
  '#00418:01',
  '#ENDIF',
  '#ENDRANDOM',
].join('\n');

// bmson keyboard-24k: keys on x = 1..24 (`11..19`, `1A..1O`), the wheel up / down on x = 25 / 26 (`1P` / `1Q`).
const KEYBOARD_24K = JSON.stringify({
  version: '1.0.0',
  info: { title: 'golden 24K', init_bpm: 145, mode_hint: 'keyboard-24k', resolution: 240 },
  lines: [{ y: 0 }, { y: 960 }, { y: 1920 }],
  bpm_events: [{ y: 1440, bpm: 290 }],
  sound_channels: [
    {
      name: 'key.wav',
      notes: [
        { x: 1, y: 960, l: 0, c: false },
        { x: 9, y: 1080, l: 0, c: false },
        { x: 10, y: 1200, l: 480, c: false },
        { x: 24, y: 1320, l: 0, c: false },
        { x: 25, y: 1440, l: 0, c: false },
        { x: 26, y: 1680, l: 120, c: false },
      ],
    },
  ],
});

describe('golden fingerprints (bmfp0)', () => {
  test.each([
    [
      'BMS 7 KEY with LN, mines, BPM, STOP, SCROLL, SPEED',
      () => computePlayFingerprint(parseBMS(SP7), { chartPath: 'golden.bms' }),
      'bmfp0:0448b7f45f40e5a5fa70bc9678154a57d55a5c6a3b134beb4c98285aa1042349',
    ],
    [
      'bmson',
      () => computePlayFingerprint(parseBmson(BMSON), { chartPath: 'golden.bmson' }),
      'bmfp0:364f1aed23cb84fb0a8f8a8110ba0c259a44f0f503a5e78a6f1c64027d3cfa25',
    ],
    [
      'PMS',
      () => computePlayFingerprint(parseBMS(PMS), { chartPath: 'golden.pms' }),
      'bmfp0:a3abd7386f12ae30af985765299f2fac6a8bdb80bfa6ed784a1373c5849a3e5c',
    ],
    [
      'DP',
      () => computePlayFingerprint(parseBMS(DP), { chartPath: 'golden.bms' }),
      'bmfp0:a4a0425fe634602d02bfe2d157e6e4fd6989d9d220874cfe5d047153f8e22ea1',
    ],
    [
      '#RANDOM chart',
      () => computeChartFingerprint(parseBMS(RANDOM), { chartPath: 'golden.bms' }),
      'bmfp0:b83b4f1280090c1bfb45c6c0ec6fa2228732a8e59b7e6195836e1c0c5658a5d8',
    ],
    [
      '#RANDOM play',
      () =>
        computePlayFingerprint(
          resolveBMSControlFlowWithDraws(parseBMS(RANDOM), [
            { command: 'RANDOM', range: 3, value: 3 },
            { command: 'SWITCH', range: 2, value: 2 },
            { command: 'RANDOM', range: 2, value: 1 },
          ]),
          { chartPath: 'golden.bms' },
        ),
      'bmfp0:8cf13280e1af1b275d9f9889c58cb4ef15349806957f25c8af46d83a328fbfd9',
    ],
    [
      'bmson keyboard-24k with wheel notes',
      () => computePlayFingerprint(parseBmson(KEYBOARD_24K), { chartPath: 'golden.bmson' }),
      'bmfp0:18daccb87f573c15d6ae49c580918356dffcb384921d2e462d572ba8b48c86d3',
    ],
  ])('%s', (_label, compute, expected) => {
    expect(compute()).toBe(expected);
  });
});
