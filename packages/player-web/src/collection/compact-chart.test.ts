import { describe, expect, test } from 'vite-plus/test';
import { parseBms } from '@be-music/parser';
import { compactCollectionChart, createStringInterner } from './compact-chart.ts';

const SOURCE = ['#TITLE Compact', '#BPM 150', '#WAV01 kick.wav', '#00111:0101', '#00211:01'].join('\n');

describe('createStringInterner', () => {
  test('returns the first instance seen for equal strings', () => {
    const intern = createStringInterner();
    const first = intern(['0', '1'].join(''));
    expect(intern(['0', '1'].join(''))).toBe(first);
    expect(intern('11')).toBe('11');
  });
});

describe('compactCollectionChart', () => {
  test('drops the preservation layers and keeps playable data intact', () => {
    const parsed = parseBms(SOURCE);
    const expected = { metadata: parsed.metadata, resources: parsed.resources, events: parsed.events, bms: parsed.bms };
    const snapshot = structuredClone(expected);
    expect(parsed.preservation.bms.sourceLines.length).toBeGreaterThan(0);

    const chart = compactCollectionChart(parsed, createStringInterner());

    expect(chart).toBe(parsed);
    expect(chart.preservation.bms.sourceLines).toEqual([]);
    expect(chart.preservation.bms.objectLines).toEqual([]);
    expect(chart.preservation.bmson.soundChannels).toEqual([]);
    expect({ metadata: chart.metadata, resources: chart.resources, events: chart.events, bms: chart.bms }).toEqual(
      snapshot,
    );
  });

  test('shares event strings across charts compacted with the same interner', () => {
    const intern = createStringInterner();
    const left = compactCollectionChart(parseBms(SOURCE), intern);
    const right = compactCollectionChart(parseBms(SOURCE), intern);
    expect(right.events[0]!.channel).toBe(left.events[0]!.channel);
    expect(right.events[0]!.value).toBe(left.events[0]!.value);
  });

  test('copies header objects so they no longer alias the parsed ones', () => {
    const parsed = parseBms(SOURCE);
    const metadata = parsed.metadata;
    const resources = parsed.resources;
    const chart = compactCollectionChart(parsed, createStringInterner());
    expect(chart.metadata).not.toBe(metadata);
    expect(chart.resources).not.toBe(resources);
    expect(chart.metadata.title).toBe('Compact');
  });
});
