import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { buildChartSelectionEntries, listChartFiles } from './chart-selection.ts';

const tempDirectories: string[] = [];
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0, tempDirectories.length)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('chart selection', () => {
  test('listChartFiles: recursively includes .bmson files', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'be-music-chart-selection-'));
    tempDirectories.push(rootDir);

    await mkdir(join(rootDir, 'nested'));
    await writeFile(join(rootDir, 'alpha.bms'), '');
    await writeFile(join(rootDir, 'nested', 'beta.bmson'), '');
    await writeFile(join(rootDir, 'nested', 'ignore.txt'), '');

    const files = await listChartFiles(rootDir);

    expect(files).toEqual([join(rootDir, 'alpha.bms'), join(rootDir, 'nested', 'beta.bmson')]);
  });

  test('buildChartSelectionEntries: includes chart TITLE and ARTIST metadata', async () => {
    const chartPath = resolve(rootDir, 'examples/test/sample.bms');

    const entries = await buildChartSelectionEntries(rootDir, [chartPath]);
    const chartEntry = entries.find((entry) => entry.kind === 'chart' && entry.filePath === chartPath);

    expect(chartEntry).toMatchObject({
      kind: 'chart',
      title: 'Sample',
      artist: 'Codex',
    });
  });

  test('buildChartSelectionEntries: includes music metadata extras used by music-select', async () => {
    const bmsPath = resolve(rootDir, 'examples/test/four-measure-command-combo-test.bms');
    const bmsonPath = resolve(rootDir, 'examples/test/bmson-strict-features.bmson');

    const entries = await buildChartSelectionEntries(rootDir, [bmsPath, bmsonPath]);
    const bmsEntry = entries.find((entry) => entry.kind === 'chart' && entry.filePath === bmsPath);
    const bmsonEntry = entries.find((entry) => entry.kind === 'chart' && entry.filePath === bmsonPath);

    expect(bmsEntry).toMatchObject({
      kind: 'chart',
      subtitle: 'Visual 4-Bar Command Blocks',
      genre: 'TEST',
      comment: 'Each 4-measure block targets a different command combination set.',
    });
    expect(bmsonEntry).toMatchObject({
      kind: 'chart',
      subtitle: 'Strict',
      subartist: 'Alice, Bob',
      genre: 'TEST',
      bannerPath: 'banner.png',
    });
  });

  test('buildChartSelectionEntries: carries BMS #BANNER into music-select metadata', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'be-music-chart-banner-'));
    tempDirectories.push(tempRoot);
    const chartPath = join(tempRoot, 'banner-test.bms');
    await writeFile(
      chartPath,
      ['#TITLE Banner Test', '#ARTIST Codex', '#BANNER banner.bmp', '#PLAYER 1', '#BPM 120'].join('\n'),
    );

    const entries = await buildChartSelectionEntries(tempRoot, [chartPath]);
    const chartEntry = entries.find((entry) => entry.kind === 'chart' && entry.filePath === chartPath);

    expect(chartEntry).toMatchObject({
      kind: 'chart',
      bannerPath: 'banner.bmp',
    });
  });
});
