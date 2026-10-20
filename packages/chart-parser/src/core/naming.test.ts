import { describe, expect, test } from 'vite-plus/test';
import { BMS_JSON_FORMAT, cloneJSON } from '@be-music/chart-source';
import { stringifyBMS, stringifyBmson } from '../../../chart-writer/src/index.ts';
import { parseBMS, parseBmson, parseChart } from './parser.ts';

describe('abbreviation naming at format boundaries', () => {
  test('BMS headers use canonical IR keys and stringify to the external directives', () => {
    const source = [
      '#BPM 130',
      '#BACKBMP back.png',
      '#VOLWAV 75',
      '#PATH_WAV samples/',
      '#BASEBPM 150',
      '#EXWAV01 sample.wav',
      '#EXBMP01 image.png',
      '#POORBGA 01',
      '#SWBGA01 02',
    ].join('\n');
    const chart = parseBMS(source);
    expect(chart.metadata.backBMP).toBe('back.png');
    expect(chart.bms).toMatchObject({
      volWAV: 75,
      pathWAV: 'samples/',
      baseBPM: 150,
      exWAV: { '01': 'sample.wav' },
      exBMP: { '01': 'image.png' },
      poorBGA: '01',
      swBGA: { '01': '02' },
    });
    expect(cloneJSON(chart)).toEqual(chart);
    const output = stringifyBMS(chart);
    for (const line of source.split('\n')) expect(output).toContain(line);
  });

  test('bmson contract keys stay unchanged while the IR uses initBPM', () => {
    const chart = parseBmson(
      JSON.stringify({
        version: '1.0.0',
        info: { init_bpm: 150, mode_hint: 'beat-7k', resolution: 240, back_image: 'back.png' },
        sound_channels: [],
        bpm_events: [{ y: 240, bpm: 180 }],
        bga: { bga_header: [{ id: 1, name: 'image.png' }], bga_events: [{ y: 0, id: 1 }] },
      }),
    );
    expect(chart.bmson.info.initBPM).toBe(150);
    expect(chart.metadata.backBMP).toBe('back.png');
    const output = JSON.parse(stringifyBmson(chart));
    expect(output.info.init_bpm).toBe(150);
    expect(output.info).not.toHaveProperty('initBPM');
    expect(output.bga.bga_header).toEqual([{ id: 1, name: 'image.png' }]);
    expect(output.bga.bga_events).toEqual([{ y: 0, id: 1 }]);
  });

  test('old IR keys are accepted on input and emitted only with the new spelling', () => {
    const chart = parseChart(
      JSON.stringify({
        format: BMS_JSON_FORMAT,
        metadata: { bpm: 130, backBmp: 'back.png' },
        bms: {
          volWav: 75,
          pathWav: 'samples/',
          baseBpm: 150,
          exWav: { '01': 'sample.wav' },
          exBmp: { '01': 'image.png' },
          poorBga: '01',
          swBga: { '01': '02' },
        },
        bmson: { info: { initBpm: 150 } },
      }),
      'json',
    );
    expect(chart.metadata.backBMP).toBe('back.png');
    expect(chart.bmson.info.initBPM).toBe(150);
    expect(chart.bms).toMatchObject({
      volWAV: 75,
      pathWAV: 'samples/',
      baseBPM: 150,
      exWAV: { '01': 'sample.wav' },
      exBMP: { '01': 'image.png' },
      poorBGA: '01',
      swBGA: { '01': '02' },
    });
    const output = JSON.stringify(chart);
    for (const key of ['backBmp', 'initBpm', 'volWav', 'pathWav', 'baseBpm', 'exWav', 'exBmp', 'poorBga', 'swBga']) {
      expect(output).not.toContain(`"${key}"`);
    }
  });

  test('canonical IR keys take precedence over legacy spellings', () => {
    const chart = parseChart(
      JSON.stringify({
        format: BMS_JSON_FORMAT,
        metadata: { bpm: 130, backBMP: 'new.png', backBmp: 'old.png' },
        bms: { baseBPM: 180, baseBpm: 150, exWAV: { '01': 'new.wav' }, exWav: { '01': 'old.wav' } },
        bmson: { info: { initBPM: 180, initBpm: 150 } },
      }),
      'json',
    );
    expect(chart.metadata.backBMP).toBe('new.png');
    expect(chart.bms.baseBPM).toBe(180);
    expect(chart.bms.exWAV).toEqual({ '01': 'new.wav' });
    expect(chart.bmson.info.initBPM).toBe(180);
  });
});
