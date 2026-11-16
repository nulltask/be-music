import { describe, expect, test } from 'vite-plus/test';
import { parseLRX } from '../../chart-parser/src/index.ts';
import { collectSampleTriggers } from './index.ts';
import { resolveLRXSamplePlayback } from './lrx-playback.ts';

describe('resolveLRXSamplePlayback', () => {
  test('maps the sound values onto the trigger units', () => {
    expect(resolveLRXSamplePlayback(undefined)).toBeUndefined();
    expect(resolveLRXSamplePlayback({ damage: 0 })).toBeUndefined();
    expect(
      resolveLRXSamplePlayback({ volume: 64, pan: 96, offsetMs: 250, lengthMs: 500, attackMs: 10, releaseMs: 20 }),
    ).toEqual({
      gain: 64 / 127,
      pan: 0.5,
      offsetSeconds: 0.25,
      durationSeconds: 0.5,
      attackSeconds: 0.01,
      releaseSeconds: 0.02,
    });
    expect(resolveLRXSamplePlayback({ pan: 0 })).toEqual({ pan: -1 });
    expect(resolveLRXSamplePlayback({ pan: 127 })).toEqual({ pan: 63 / 64 });
  });

  test('stretches len / atk / rls by the integer part of 44100 / frq, as plugout does', () => {
    // Half rate: a 500 ms length sounds 1 s, which is 0.5 s of the sample.
    expect(resolveLRXSamplePlayback({ frequency: 22050, lengthMs: 500, releaseMs: 100 })).toEqual({
      playbackRate: 0.5,
      durationSeconds: 0.5,
      releaseSeconds: 0.1,
    });
    // 30 kHz: the factor is 1, so the length is sounding time and covers less of the sample.
    expect(resolveLRXSamplePlayback({ frequency: 33075, lengthMs: 1000 })).toEqual({
      playbackRate: 0.75,
      durationSeconds: 0.75,
    });
    // Above 44100 Hz plugout's factor would be 0; Be-Music keeps 1.
    expect(resolveLRXSamplePlayback({ frequency: 88200, lengthMs: 1000 })).toEqual({
      playbackRate: 2,
      durationSeconds: 2,
    });
  });
});

describe('LRX sample triggers', () => {
  test('carry each note its own playback, and only LRX notes do', () => {
    const chart = parseLRX({
      lrs:
        '<LRS><sound id="0" filename="a.wav" /><n c="301" s="0" p="120" />' +
        '<n c="100" s="0" p="0" vol="0" pan="0" frq="22050" ost="100" len="200" atk="5" rls="7" />' +
        '<n c="101" s="480" p="0" /></LRS>',
    });
    const [shaped, plain] = collectSampleTriggers(chart);
    expect(shaped).toMatchObject({
      sampleKey: '01',
      sampleGain: 0,
      samplePan: -1,
      samplePlaybackRate: 0.5,
      sampleOffsetSeconds: 0.1,
      sampleDurationSeconds: 0.2,
      sampleAttackSeconds: 0.005,
      sampleReleaseSeconds: 0.007,
    });
    expect(plain!.sampleOffsetSeconds).toBe(0);
    expect(Object.keys(plain!)).not.toContain('sampleGain');
  });
});
