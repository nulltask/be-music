import { describe, expect, test, vi } from 'vite-plus/test';
import { parseBMS, parseBmson } from '@be-music/chart-parser';
import {
  compactCollectionChart,
  deferChartFields,
  PackedEventStrings,
  restoreDeferredChartFields,
} from './compact-chart.ts';

const SOURCE = ['#TITLE Compact', '#BPM 150', '#WAV01 kick.wav', '#00111:0101', '#00211:01'].join('\n');

function chartOf(title: string) {
  return parseBMS(SOURCE.replace('Compact', title));
}

describe('compactCollectionChart', () => {
  test('drops formatting layers, retains WAV loader order and keeps playable data intact', () => {
    const parsed = parseBMS(SOURCE);
    const snapshot = structuredClone({
      metadata: parsed.metadata,
      resources: parsed.resources,
      events: parsed.events,
      bms: parsed.bms,
    });
    expect(parsed.preservation.bms.sourceLines.length).toBeGreaterThan(0);

    const chart = compactCollectionChart(parsed, new PackedEventStrings());

    expect(chart).toBe(parsed);
    expect(chart.preservation.bms.sourceLines).toEqual([{ kind: 'header', command: 'WAV01', value: 'kick.wav' }]);
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
    const parsed = parseBMS(SOURCE);
    const metadata = parsed.metadata;
    const resources = parsed.resources;
    const chart = compactCollectionChart(parsed, new PackedEventStrings());
    expect(chart.metadata).not.toBe(metadata);
    expect(chart.resources).not.toBe(resources);
    expect(chart.metadata.title).toBe('Compact');
  });
});

describe('deferChartFields / restoreDeferredChartFields', () => {
  test('takes the fields a listing does not read out of the chart, as text', () => {
    const chart = chartOf('Deferred');
    const resources = structuredClone(chart.resources);
    const deferred = deferChartFields(chart);
    expect(Object.keys(chart)).toEqual(['format', 'sourceFormat', 'metadata', 'events']);
    expect(chart.metadata.title).toBe('Deferred');
    expect(deferred.keys).toEqual(['resources', 'measures', 'bms', 'bmson', 'preservation']);
    expect((JSON.parse(deferred.json) as { resources: unknown }).resources).toEqual(resources);
  });

  test('puts the fields back as they were, parsed once when one is first read', () => {
    const expected = chartOf('Deferred');
    const chart = chartOf('Deferred');
    const deferred = structuredClone(deferChartFields(chart));
    const parse = vi.spyOn(JSON, 'parse');
    restoreDeferredChartFields(chart, deferred);
    // Listing a chart reads its headers only: nothing is parsed, yet the fields are there to see.
    expect(chart.metadata.title).toBe('Deferred');
    expect(Object.keys(chart).sort()).toEqual(Object.keys(expected).sort());
    expect('resources' in chart).toBe(true);
    expect(parse).not.toHaveBeenCalled();
    expect(chart.resources).toEqual(expected.resources);
    expect(chart.bms).toEqual(expected.bms);
    expect(chart.preservation).toEqual(expected.preservation);
    expect(chart.resources).toBe(chart.resources);
    expect(parse).toHaveBeenCalledTimes(1);
    parse.mockRestore();
    expect(chart).toEqual(expected);
    expect({ ...chart }).toEqual({ ...expected });
    expect(structuredClone(chart)).toEqual(expected);
  });

  test('assigning a field replaces it, before or after the others are read', () => {
    const chart = chartOf('Deferred');
    const expected = structuredClone(chart);
    restoreDeferredChartFields(chart, deferChartFields(chart));
    const resources = { ...expected.resources, wav: { '01': 'snare.wav' } };
    chart.resources = resources;
    expect(chart.resources).toBe(resources);
    expect(chart.bms).toEqual(expected.bms);
    expect(chart.resources).toBe(resources);
    const measures = [{ index: 1, length: 0.5 }];
    chart.measures = measures;
    expect(chart.measures).toBe(measures);
  });

  test('leaves a chart without deferred fields as it is', () => {
    const chart = chartOf('Whole');
    const expected = structuredClone(chart);
    restoreDeferredChartFields(chart, undefined);
    expect(chart).toEqual(expected);
  });
});
