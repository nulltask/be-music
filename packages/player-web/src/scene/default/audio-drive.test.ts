import { describe, expect, it } from 'vite-plus/test';
import { SILENT_AUDIO } from '../../runtime/audio-analysis.ts';
import { audioDrive, bandAt, bandLevel } from './audio-drive.ts';

const LOUD = {
  ...SILENT_AUDIO,
  level: 0.8,
  peak: 0.9,
  db: -6,
  bass: 0.6,
  mid: 0.4,
  high: 0.2,
  bands: Array.from({ length: 16 }, (_, index) => index / 15),
  onset: 1,
  onsetAtMs: 1234,
};

describe('audioDrive', () => {
  it('passes the analysis through at full effects', () => {
    const drive = audioDrive(LOUD, 'full');
    expect(drive.bass).toBe(0.6);
    expect(drive.bands).toBe(LOUD.bands);
    expect(drive.onsetAtMs).toBe(1234);
  });

  it('halves every reaction when reduced', () => {
    const drive = audioDrive(LOUD, 'reduced');
    expect(drive.level).toBeCloseTo(0.4, 9);
    expect(drive.bands[15]).toBeCloseTo(0.5, 9);
    expect(drive.onset).toBe(0.5);
    expect(drive.db).toBe(-6);
  });

  it('is silent when effects are off or there is no audio', () => {
    for (const drive of [audioDrive(LOUD, 'off'), audioDrive(undefined, 'full')]) {
      expect(drive.level).toBe(0);
      expect(drive.onset).toBe(0);
      expect(drive.onsetAtMs).toBeUndefined();
      expect(drive.bands.every((band) => band === 0)).toBe(true);
    }
  });
});

describe('bandAt', () => {
  const bands = [0, 0.25, 0.5, 1];

  it('maps columns onto bands', () => {
    expect([0, 1, 2, 3].map((index) => bandAt(bands, index, 4))).toEqual(bands);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((index) => bandAt(bands, index, 8))).toEqual([
      0, 0, 0.25, 0.25, 0.5, 0.5, 1, 1,
    ]);
  });

  it('is zero for empty input', () => {
    expect(bandAt([], 0, 4)).toBe(0);
    expect(bandAt(bands, 0, 0)).toBe(0);
  });
});

describe('bandLevel', () => {
  it('stretches quiet and loud bands to the full 0..1 range', () => {
    expect(bandLevel([0.1, 0.1], 0, 2)).toBe(0);
    expect(bandLevel([0.95, 0.95], 0, 2)).toBe(1);
  });

  it('tilts toward the treble', () => {
    const flat = [0.4, 0.4, 0.4, 0.4];
    expect(bandLevel(flat, 3, 4)).toBeGreaterThan(bandLevel(flat, 0, 4));
  });
});
