import { describe, expect, test } from 'vite-plus/test';
import { parseBms, parseBmson } from '@be-music/parser';
import { compactCollectionChart, PackedEventStrings } from './compact-chart.ts';

const SOURCE = ['#TITLE Compact', '#BPM 150', '#WAV01 kick.wav', '#00111:0101', '#00211:01'].join('\n');

function chartOf(title: string) {
  return parseBms(SOURCE.replace('Compact', title));
}

describe('compactCollectionChart', () => {
  test('drops the preservation layers and keeps playable data intact', () => {
    const parsed = parseBms(SOURCE);
    const snapshot = structuredClone({
      metadata: parsed.metadata,
      resources: parsed.resources,
      events: parsed.events,
      bms: parsed.bms,
    });
    expect(parsed.preservation.bms.sourceLines.length).toBeGreaterThan(0);

    const chart = compactCollectionChart(parsed, new PackedEventStrings());

    expect(chart).toBe(parsed);
    expect(chart.preservation.bms.sourceLines).toEqual([]);
    expect(chart.preservation.bms.objectLines).toEqual([]);
    expect(chart.preservation.bmson.soundChannels).toEqual([]);
    expect({ metadata: chart.metadata, resources: chart.resources, events: chart.events, bms: chart.bms }).toEqual(
      snapshot,
    );
  });

  test('rebuilds events on demand and reuses the rebuilt array while it is recent', () => {
    const chart = compactCollectionChart(chartOf('Lazy'), new PackedEventStrings());
    const first = chart.events;
    expect(first.length).toBe(3);
    expect(chart.events).toBe(first);
    expect(Object.keys(chart)).toContain('events');
    expect({ ...chart }.events).toEqual(first);
  });

  test('rebuilds an evicted chart with equal events', () => {
    const strings = new PackedEventStrings();
    const target = compactCollectionChart(chartOf('Target'), strings);
    const before = target.events;
    for (let index = 0; index < 80; index += 1) {
      void compactCollectionChart(chartOf(`Other ${index}`), strings).events;
    }
    const after = target.events;
    expect(after).not.toBe(before);
    expect(after).toEqual(before);
  });

  test('assigning events replaces the packed copy', () => {
    const chart = compactCollectionChart(chartOf('Assigned'), new PackedEventStrings());
    const replacement = chart.events.slice(0, 1);
    chart.events = replacement;
    expect(chart.events).toBe(replacement);
  });

  test('keeps bmson note extensions', () => {
    const parsed = parseBmson(
      JSON.stringify({
        version: '1.0.0',
        info: { title: 'Ext', init_bpm: 120, resolution: 240, mode_hint: 'beat-7k' },
        sound_channels: [{ name: 'a.wav', notes: [{ x: 1, y: 0, l: 240, c: false }] }],
      }),
    );
    const expected = structuredClone(parsed.events);
    expect(expected.some((event) => event.bmson !== undefined)).toBe(true);
    const chart = compactCollectionChart(parsed, new PackedEventStrings());
    expect(chart.events).toEqual(expected);
  });

  test('copies header objects so they no longer alias the parsed ones', () => {
    const parsed = parseBms(SOURCE);
    const metadata = parsed.metadata;
    const resources = parsed.resources;
    const chart = compactCollectionChart(parsed, new PackedEventStrings());
    expect(chart.metadata).not.toBe(metadata);
    expect(chart.resources).not.toBe(resources);
    expect(chart.metadata.title).toBe('Compact');
  });
});
