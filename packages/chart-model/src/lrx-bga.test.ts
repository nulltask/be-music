import { describe, expect, test } from 'vite-plus/test';
import { parseLRX } from '../../chart-parser/src/index.ts';
import { easeLRXBGA, resolveLRXBGAProgram, sampleLRXBGA } from './lrx-bga.ts';

// BPM 120: 480 ticks is 0.5 s.
const chart = (...notes: string[]) =>
  parseLRX({
    lrs: `<LRS><n c="301" s="0" p="120" /><n c="300" s="0" /></LRS>`,
    lrm: `<LRM><image id="0" filename="a.png" /><image id="1" filename="b.png" /><image id="2" filename="c.png" /><image id="3" filename="d.png" />${notes.join('')}</LRM>`,
  });
const program = (...notes: string[]) => resolveLRXBGAProgram(chart(...notes), (beat) => beat / 2)!;
const size = () => [256, 128] as const;

describe('easeLRXBGA', () => {
  test('eases linearly, accelerating or decelerating, and holds the ends outside the span', () => {
    expect(easeLRXBGA(0, 100, 0, 1, 0.5, 0)).toBe(50);
    expect(easeLRXBGA(0, 100, 0, 1, 0.5, 1)).toBe(25);
    expect(easeLRXBGA(0, 100, 0, 1, 0.5, 2)).toBe(75);
    expect(easeLRXBGA(0, 100, 0, 1, -1, 0)).toBe(0);
    expect(easeLRXBGA(0, 100, 0, 1, 2, 0)).toBe(100);
    expect(easeLRXBGA(7, 7, 0, 1, 0.5, 0)).toBe(7);
  });
});

describe('LRX BGA program', () => {
  test('a chart of plain images has none: its BMS channels play it', () => {
    expect(resolveLRXBGAProgram(chart('<n c="200" s="0" p="0" />'), (beat) => beat)).toBeUndefined();
  });

  test('a still note draws as written, its colour only with a destination', () => {
    const bga = program(
      '<n c="203" s="0" p="1" sx="0" sy="0" sw="64" sh="64" />',
      '<n c="200" s="0" p="0" dx="10" dy="20" dw="30" dh="40" a="128" rot="45" bld="1" ctr="5" />',
    );
    expect(sampleLRXBGA(bga, 3, 0, size)).toEqual({
      key: '02',
      src: [0, 0, 64, 64],
      fill: 'image',
      color: [255, 255, 255, 255],
      blend: 0,
      rotation: 0,
      center: 0,
    });
    expect(sampleLRXBGA(bga, 0, 0, size)).toMatchObject({
      key: '01',
      dst: [10, 20, 30, 40],
      color: [128, 255, 255, 255],
      blend: 1,
      rotation: 45,
      center: 5,
    });
    expect(sampleLRXBGA(bga, 1, 0, size)).toBeUndefined();
  });

  test("a keyframe chain eases from its first note to the next one's end, counting the image up", () => {
    // A note at 0 s and a keyframe at 0.5 s whose motion ends at 1 s (`e`), easing by the first note's `acc`.
    const bga = program(
      '<n c="201" s="0" p="0" dx="0" dy="0" dw="100" dh="100" rot="0" acc="0" />',
      '<n c="201" s="480" e="960" p="3" cn="1" dx="100" dy="0" dw="100" dh="100" rot="90" />',
    );
    const at = (seconds: number) => sampleLRXBGA(bga, 1, seconds, size)!;
    expect(at(0)).toMatchObject({ key: '01', dst: [0, 0, 100, 100], rotation: 0, fill: 'screen' });
    expect(at(0.5)).toMatchObject({ key: '02', dst: [50, 0, 100, 100], rotation: 45 });
    expect(at(0.75)).toMatchObject({ key: '03', dst: [75, 0, 100, 100] });
    expect(at(1)).toMatchObject({ key: '04', dst: [100, 0, 100, 100], rotation: 90 });
    // The source rectangle eases from the whole first image.
    expect(at(0.5).src).toEqual([0, 0, 256, 128]);
  });
});
