import { expect, test } from 'vite-plus/test';
import { parseBmson, parseChart } from '../index.ts';
import { readBmsonExtraFields, normalizeBmsonExtraFieldMap } from './bmson-extra-fields.ts';

test('native annotations and the IR envelope remain distinct across JSON reparse', () => {
  const chart = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      vendor: { a: [null, false] },
      extraFields: 'external',
      info: { init_bpm: 120, vendor: 'info' },
      sound_channels: [
        { name: 'a.wav', vendor: 'channel', notes: [{ x: 1, y: 0, vendor: 'note', extraFields: 'note-source' }] },
      ],
      bga: {
        vendor: 'bga',
        bga_header: [{ id: 1, name: 'a.png', vendor: 'image' }],
        bga_events: [{ y: 0, id: 1, vendor: 'cue' }],
      },
    }),
  );
  expect(chart.bmson.extraFields).toEqual({ vendor: { a: [null, false] }, extraFields: 'external' });
  expect(chart.events[0]?.bmson?.extraFields).toEqual({ vendor: 'note', extraFields: 'note-source' });
  expect(chart.bmson.channelExtraFields?.['01']).toEqual({ vendor: 'channel' });
  expect(parseChart(JSON.stringify(chart), 'json')).toEqual(chart);
});

test('hidden damage is retained as inert source data and never becomes mine damage', () => {
  const chart = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120 },
      key_channels: [{ name: 'hidden.wav', notes: [{ x: 1, y: 240, damage: 0 }] }],
    }),
  );
  expect(chart.events[0]).toMatchObject({ channel: '31', bmson: { extraFields: { damage: 0 } } });
  expect(chart.events[0]?.bmson?.damage).toBeUndefined();
});

test('IR helpers reject invalid envelopes and retain only valid independent maps', () => {
  expect(readBmsonExtraFields({ extraFields: { vendor: [1] } }, 'root', true)).toEqual({
    extraFields: { vendor: [1] },
  });
  expect(readBmsonExtraFields({ vendor: 1 }, 'root', true)).toEqual({});
  expect(normalizeBmsonExtraFieldMap({ '01': { vendor: [1] }, invalid: [] })).toEqual({ '01': { vendor: [1] } });
  expect(normalizeBmsonExtraFieldMap([])).toBeUndefined();
});
