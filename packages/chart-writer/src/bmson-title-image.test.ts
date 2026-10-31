import { expect, test } from 'vite-plus/test';
import { parseBmson, parseChart } from '@be-music/chart-parser';
import { cloneJSON } from '@be-music/chart-source';
import { stringifyBmson } from './index.ts';

test('preserves separate title, banner, loading and background artwork through bmson and Be-Music JSON', () => {
  const chart = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: {
        init_bpm: 120,
        title_image: 'title.png',
        eyecatch_image: 'loading.png',
        back_image: 'back.png',
        banner_image: 'banner.png',
      },
      sound_channels: [],
    }),
  );
  expect(chart.metadata.titleImage).toBe('title.png');
  expect(chart.metadata.stageFile).toBe('loading.png');
  expect(chart.metadata.backBMP).toBe('back.png');
  expect(chart.metadata.banner).toBe('banner.png');
  for (const source of [chart, cloneJSON(chart), parseChart(JSON.stringify(chart), 'json')]) {
    expect(source.bmson.info.titleImage).toBe('title.png');
    expect(JSON.parse(stringifyBmson(source)).info).toMatchObject({
      title_image: 'title.png',
      eyecatch_image: 'loading.png',
      back_image: 'back.png',
      banner_image: 'banner.png',
    });
    // Force the canonical writer as well as the preservation fast path.
    source.metadata.title = 'Edited';
    expect(JSON.parse(stringifyBmson(source)).info.title_image).toBe('title.png');
  }
});
