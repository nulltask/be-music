import { expect, test } from 'vite-plus/test';
import { parseBmson } from '@be-music/chart-parser';
import { createTimingResolver } from './index.ts';

// bmson orders one pulse as notes/BGA, then BPM, then STOP; the last BPM on a pulse wins and its STOPs add up.
// https://github.com/bemusic/bmson-spec/blob/668c4338cd7c64da2d2ec0f848c4ad58a3a881d9/doc/index.rst
test('bmson: a pulse plays its notes, then its last BPM, then the sum of its STOPs', () => {
  const json = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240, mode_hint: 'beat-7k' },
      sound_channels: [
        {
          name: 'a.wav',
          notes: [
            { x: 1, y: 240, l: 0, c: false },
            { x: 2, y: 480, l: 0, c: false },
          ],
        },
      ],
      bpm_events: [
        { y: 240, bpm: 60 },
        { y: 240, bpm: 240 },
      ],
      stop_events: [
        { y: 240, duration: 240 },
        { y: 240, duration: 240 },
      ],
    }),
  );
  const timing = createTimingResolver(json);

  expect(timing.tempoPoints.map(({ beat, bpm }) => ({ beat, bpm }))).toEqual([
    { beat: 0, bpm: 120 },
    { beat: 1, bpm: 240 },
  ]);
  // Each one-beat STOP runs at the pulse's final BPM (240), so the two add up to 0.5 s.
  expect(timing.stopPoints.map((point) => point.seconds)).toEqual([0.25, 0.25]);
  const noteSeconds = json.events
    .filter((event) => event.channel.startsWith('1'))
    .map((event) => timing.eventToSeconds(event));
  // The note on the STOP pulse sounds before the STOP; the next beat follows 0.5 s of STOP and 0.25 s at 240 BPM.
  expect(noteSeconds).toEqual([0.5, 1.25]);
});
