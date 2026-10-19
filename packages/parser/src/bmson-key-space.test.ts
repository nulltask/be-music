import { describe, expect, test } from 'vite-plus/test';
import { normalizeObjectKey, resolveBMSBase, type BeMusicEvent, type BeMusicJSON } from '../../json/src/index.ts';
import { createTimingResolver } from '../../chart/src/index.ts';
import { parseBmson } from './index.ts';

// Charts without `lines` keep 4/4 measures, so a pulse at resolution 240 is `(measure + position) × 4 × 240`.
const RESOLUTION = 240;

function eventPulse(event: BeMusicEvent): number {
  return Math.round((event.measure + event.position[0] / event.position[1]) * 4 * RESOLUTION);
}

function lookup<T>(json: BeMusicJSON, table: Record<string, T>, event: BeMusicEvent): T | undefined {
  return table[normalizeObjectKey(event.value, resolveBMSBase(json))];
}

function eventsOn(json: BeMusicJSON, channel: string): BeMusicEvent[] {
  return json.events.filter((event) => event.channel === channel);
}

function parse(document: Record<string, unknown>): BeMusicJSON {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 150, resolution: RESOLUTION, mode_hint: 'beat-7k' },
      sound_channels: [{ name: 's.wav', notes: [{ x: 1, y: 0 }] }],
      ...document,
    }),
  );
}

describe('bmson key space', () => {
  test('keeps every BPM change past 1,295 bpm_events instead of wrapping keys round onto earlier values', () => {
    const bpmEvents = Array.from({ length: 2_000 }, (_, index) => ({
      y: index * 60,
      bpm: index % 2 === 0 ? 150 : 600,
    }));
    const json = parse({ bpm_events: bpmEvents });

    const events = eventsOn(json, '08');
    expect(events).toHaveLength(bpmEvents.length);
    // Two distinct tempos need two keys.
    expect(Object.keys(json.resources.bpm)).toHaveLength(2);
    expect(json.bms.base).toBeUndefined();
    for (const event of events) {
      const authored = bpmEvents[eventPulse(event) / 60]!;
      expect(lookup(json, json.resources.bpm, event)).toBe(authored.bpm);
    }
  });

  test('of several BPM changes on one pulse, the later one in the list wins', () => {
    // 200 is keyed first, so ordering the events on a pulse by key would let 150 lose to the earlier-listed 200.
    const json = parse({
      bpm_events: [
        { y: 0, bpm: 200 },
        { y: 960, bpm: 150 },
        { y: 960, bpm: 200 },
      ],
    });
    const timing = createTimingResolver(json);
    expect(timing.bpmAtBeat(4)).toBe(200);
    expect(timing.bpmAtBeat(5)).toBe(200);
  });

  test('STOPs on one pulse still add up', () => {
    const json = parse({
      stop_events: [
        { y: 960, duration: 240 },
        { y: 960, duration: 480 },
      ],
    });
    // Three beats at 150 BPM in all.
    expect(createTimingResolver(json).beatToSeconds(4.5) - 0.5 * (60 / 150)).toBeCloseTo(
      4 * (60 / 150) + 3 * (60 / 150),
      9,
    );
  });

  test('keeps every STOP length past 1,295 stop_events', () => {
    const durations = [12, 24, 36, 48, 60, 72, 84, 96];
    const stopEvents = Array.from({ length: 1_500 }, (_, index) => ({
      y: index * 60,
      duration: durations[index % durations.length]!,
    }));
    const json = parse({ stop_events: stopEvents });

    const events = eventsOn(json, '09');
    expect(events).toHaveLength(stopEvents.length);
    expect(Object.keys(json.resources.stop)).toHaveLength(durations.length);
    for (const event of events) {
      const authored = stopEvents[eventPulse(event) / 60]!;
      expect(lookup(json, json.resources.stop, event)).toBeCloseTo((authored.duration * 48) / RESOLUTION, 9);
    }
  });

  test('switches the chart to base-62 keys when more than 1,295 distinct tempos appear', () => {
    const bpmEvents = Array.from({ length: 1_400 }, (_, index) => ({ y: index * 60, bpm: 100 + index }));
    const json = parse({ bpm_events: bpmEvents });

    expect(json.bms.base).toBe(62);
    const events = eventsOn(json, '08');
    expect(events).toHaveLength(bpmEvents.length);
    for (const event of events) {
      expect(lookup(json, json.resources.bpm, event)).toBe(bpmEvents[eventPulse(event) / 60]!.bpm);
    }
  });

  test('gives each of more than 1,295 sound / key / mine channels its own WAV slot', () => {
    const soundChannels = Array.from({ length: 1_300 }, (_, index) => ({
      name: `s${index}.wav`,
      notes: [{ x: 1, y: (index + 1) * RESOLUTION }],
    }));
    const json = parse({
      sound_channels: soundChannels,
      key_channels: [{ name: 'hidden.wav', notes: [{ x: 2, y: 0 }] }],
      mine_channels: [{ name: 'mine.wav', notes: [{ x: 3, y: 0, damage: 10 }] }],
    });

    expect(json.bms.base).toBe(62);
    expect(Object.keys(json.resources.wav)).toHaveLength(1_302);
    for (const event of eventsOn(json, '11')) {
      expect(lookup(json, json.resources.wav, event)).toBe(`s${eventPulse(event) / RESOLUTION - 1}.wav`);
    }
    expect(lookup(json, json.resources.wav, eventsOn(json, '32')[0]!)).toBe('hidden.wav');
    expect(lookup(json, json.resources.wav, eventsOn(json, 'D3')[0]!)).toBe('mine.wav');
  });
});
