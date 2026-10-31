import { expect, test } from 'vite-plus/test';
import { createEmptyJSON } from '@be-music/chart-source';
import { collectBmsWAVPlaybackModifiers, resolveBmsWAVPlayback } from './wav-playback.ts';

test('MacBeat pitch uses 60 as unity and composes with native-rate EXWAV frequency', () => {
  const json = createEmptyJSON('bms');
  json.bms.wavCmds = ['00 01 72', '02 01 500'];
  json.bms.exWAV = { '01': 'pf -600 22050 a.wav' };
  const modifiers = collectBmsWAVPlaybackModifiers(json).get('01')!;
  expect(modifiers).toEqual({ semitones: 12, durationSeconds: 0.25, pan: -600, frequencyHz: 22050 });
  expect(resolveBmsWAVPlayback(modifiers, 44100)).toEqual({
    playbackRate: 1,
    leftGain: 1,
    rightGain: 10 ** (-600 / 2000),
    maxDurationSeconds: 0.25,
  });
});
test('last command wins independently, zero duration restores natural end, radix preserves distinct slots', () => {
  const json = createEmptyJSON('bms');
  json.bms.base = 62;
  json.bms.wavCmds = ['00 0a 72', '00 0A 60', '02 0a 2000', '02 0a 0', '00 0a 48'];
  const modifiers = collectBmsWAVPlaybackModifiers(json);
  expect(modifiers.get('0a')).toEqual({ semitones: -12, durationSeconds: undefined });
  expect(resolveBmsWAVPlayback(modifiers.get('0A')!, 44100).playbackRate).toBe(1);
  expect(resolveBmsWAVPlayback(modifiers.get('0a')!, 44100).playbackRate).toBe(0.5);
});
test('clamps dialect bounds and makes extreme pan silent without stereo crossfeed', () => {
  const json = createEmptyJSON('bms');
  json.bms.wavCmds = ['00 01 -1', '00 02 999'];
  json.bms.exWAV = { '01': 'pf 12000 0 a.wav', '02': 'pf -12000 200000 b.wav' };
  const modifiers = collectBmsWAVPlaybackModifiers(json);
  expect(modifiers.get('01')).toMatchObject({ semitones: -60, pan: 10000, frequencyHz: 100 });
  expect(modifiers.get('02')).toMatchObject({ semitones: 67, pan: -10000, frequencyHz: 100000 });
  expect(resolveBmsWAVPlayback(modifiers.get('01')!, 44100)).toMatchObject({ leftGain: 0, rightGain: 1 });
  expect(resolveBmsWAVPlayback(modifiers.get('02')!, 44100)).toMatchObject({ leftGain: 1, rightGain: 0 });
});
test('volume-only and malformed entries do not create a sample transform', () => {
  const json = createEmptyJSON('bms');
  json.bms.wavCmds = ['01 01 50', 'garbage'];
  json.bms.exWAV = { '01': 'v -600 a.wav', '02': 'pf no nope file.wav' };
  expect(collectBmsWAVPlaybackModifiers(json).size).toBe(0);
});
test('rejects invalid native rates or non-finite modifier values', () => {
  expect(() => resolveBmsWAVPlayback({}, 0)).toThrow(RangeError);
  expect(() => resolveBmsWAVPlayback({ semitones: NaN }, 44100)).toThrow(RangeError);
});
