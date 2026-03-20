import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildChartSelectionEntries, listChartFiles } from './chart-selection.ts';

const tempDirectories: string[] = [];
const originalHome = process.env.HOME;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

afterEach(async () => {
  if (typeof originalHome === 'string') {
    process.env.HOME = originalHome;
  } else {
    delete process.env.HOME;
  }
  vi.restoreAllMocks();
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

  test('buildChartSelectionEntries: reports progress for every chart while building in parallel', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'be-music-chart-progress-'));
    tempDirectories.push(tempRoot);

    const chartPaths = [
      join(tempRoot, 'alpha.bms'),
      join(tempRoot, 'beta.bms'),
      join(tempRoot, 'gamma.bms'),
    ];
    await Promise.all(
      chartPaths.map((chartPath, index) =>
        writeFile(chartPath, [`#TITLE Chart ${index + 1}`, '#ARTIST Codex', '#PLAYER 1', '#BPM 120'].join('\n')),
      ),
    );

    const progressUpdates: Array<{ filePath: string; currentIndex: number; totalCount: number }> = [];
    const entries = await buildChartSelectionEntries(tempRoot, chartPaths, {
      onLoadingFile: (progress) => {
        progressUpdates.push(progress);
      },
    });

    expect(entries.filter((entry) => entry.kind === 'chart')).toHaveLength(chartPaths.length);
    expect(progressUpdates).toHaveLength(chartPaths.length);
    expect(progressUpdates.at(-1)).toMatchObject({
      currentIndex: chartPaths.length,
      totalCount: chartPaths.length,
    });
    expect(new Set(progressUpdates.map((progress) => progress.filePath))).toEqual(new Set(chartPaths));
  });

  test('buildChartSelectionEntries: completes large parallel loads without stalling on preview key resolution', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'be-music-chart-stress-'));
    tempDirectories.push(tempRoot);

    const chartSource = ['#TITLE Stress', '#ARTIST Codex', '#PLAYER 1', '#BPM 120', '#WAV01 sample.wav', '#00101:01'].join(
      '\n',
    );
    const chartPaths = Array.from({ length: 128 }, (_, index) => join(tempRoot, `stress-${index}.bms`));
    await Promise.all(chartPaths.map((chartPath) => writeFile(chartPath, chartSource)));

    const entries = await Promise.race([
      buildChartSelectionEntries(tempRoot, chartPaths),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('chart selection build timed out')), 3_000);
      }),
    ]);

    expect(entries.filter((entry) => entry.kind === 'chart')).toHaveLength(chartPaths.length);
  });

  test('buildChartSelectionEntries: reuses cached summaries when chart content is unchanged', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'be-music-chart-cache-hit-'));
    const tempHome = await mkdtemp(join(tmpdir(), 'be-music-chart-cache-home-'));
    tempDirectories.push(tempRoot, tempHome);
    process.env.HOME = tempHome;

    const chartPath = join(tempRoot, 'cached-hit.bms');
    const originalSource = ['#TITLE Cache Hit', '#ARTIST Codex', '#PLAYER 1', '#BPM 120'].join('\n');
    await writeFile(chartPath, originalSource);

    const firstEntries = await buildChartSelectionEntries(tempRoot, [chartPath]);
    const firstChart = firstEntries.find((entry) => entry.kind === 'chart' && entry.filePath === chartPath);
    expect(firstChart).toMatchObject({
      kind: 'chart',
      title: 'Cache Hit',
      artist: 'Codex',
    });

    const initialStat = await stat(chartPath);
    const parser = await import('@be-music/parser');
    const parseChartSpy = vi.spyOn(parser, 'parseChart');
    const shiftedMtime = new Date(initialStat.mtimeMs + 10_000);
    await utimes(chartPath, shiftedMtime, shiftedMtime);

    const secondEntries = await buildChartSelectionEntries(tempRoot, [chartPath]);
    const secondChart = secondEntries.find((entry) => entry.kind === 'chart' && entry.filePath === chartPath);
    expect(secondChart).toMatchObject({
      kind: 'chart',
      title: 'Cache Hit',
      artist: 'Codex',
    });
    expect(parseChartSpy).not.toHaveBeenCalled();

    const cachePath = join(tempHome, '.be-music', 'chart-selection-cache.json');
    const cacheJson = JSON.parse(await readFile(cachePath, 'utf8')) as {
      entries: Record<
        string,
        {
          contentHash: string;
          cacheHash: string;
          summary: Record<string, unknown>;
        }
      >;
    };
    const [cacheEntry] = Object.values(cacheJson.entries);
    expect(cacheEntry).toBeDefined();
    expect(cacheEntry?.contentHash).toEqual(expect.any(String));
    expect(cacheEntry?.cacheHash).toEqual(expect.any(String));
    expect(cacheEntry?.summary.filePath).toBeUndefined();
  });

  test('buildChartSelectionEntries: invalidates cached summaries when cache contents are tampered without updating cacheHash', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'be-music-chart-cache-tamper-'));
    const tempHome = await mkdtemp(join(tmpdir(), 'be-music-chart-cache-home-'));
    tempDirectories.push(tempRoot, tempHome);
    process.env.HOME = tempHome;

    const chartPath = join(tempRoot, 'cached-tamper.bms');
    await writeFile(chartPath, ['#TITLE Original', '#ARTIST Codex', '#PLAYER 1', '#BPM 120'].join('\n'));

    await buildChartSelectionEntries(tempRoot, [chartPath]);

    const cachePath = join(tempHome, '.be-music', 'chart-selection-cache.json');
    const cacheJson = JSON.parse(await readFile(cachePath, 'utf8')) as {
      entries: Record<
        string,
        {
          contentHash: string;
          cacheHash: string;
          summary: Record<string, unknown>;
        }
      >;
    };
    const [contentHash] = Object.keys(cacheJson.entries);
    cacheJson.entries[contentHash]!.summary.title = 'Tampered';
    await writeFile(cachePath, `${JSON.stringify(cacheJson, null, 2)}\n`, 'utf8');

    const parser = await import('@be-music/parser');
    const parseChartSpy = vi.spyOn(parser, 'parseChart');

    const secondEntries = await buildChartSelectionEntries(tempRoot, [chartPath]);
    const secondChart = secondEntries.find((entry) => entry.kind === 'chart' && entry.filePath === chartPath);

    expect(secondChart).toMatchObject({
      kind: 'chart',
      title: 'Original',
    });
    expect(parseChartSpy).toHaveBeenCalled();
  });

  test('buildChartSelectionEntries: invalidates cached summaries when chart contents change without size or mtime changes', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'be-music-chart-cache-miss-'));
    const tempHome = await mkdtemp(join(tmpdir(), 'be-music-chart-cache-home-'));
    tempDirectories.push(tempRoot, tempHome);
    process.env.HOME = tempHome;

    const chartPath = join(tempRoot, 'cached-miss.bms');
    const firstSource = ['#TITLE First', '#ARTIST Codex', '#PLAYER 1', '#BPM 120'].join('\n');
    const secondSource = ['#TITLE Other', '#ARTIST Codex', '#PLAYER 1', '#BPM 120'].join('\n');
    expect(Buffer.byteLength(firstSource)).toBe(Buffer.byteLength(secondSource));
    await writeFile(chartPath, firstSource);

    const firstEntries = await buildChartSelectionEntries(tempRoot, [chartPath]);
    const firstChart = firstEntries.find((entry) => entry.kind === 'chart' && entry.filePath === chartPath);
    expect(firstChart).toMatchObject({
      kind: 'chart',
      title: 'First',
    });

    const initialStat = await stat(chartPath);
    await writeFile(chartPath, secondSource);
    await utimes(chartPath, initialStat.atime, initialStat.mtime);

    const secondEntries = await buildChartSelectionEntries(tempRoot, [chartPath]);
    const secondChart = secondEntries.find((entry) => entry.kind === 'chart' && entry.filePath === chartPath);
    expect(secondChart).toMatchObject({
      kind: 'chart',
      title: 'Other',
    });
  });

  test('buildChartSelectionEntries: reuses cached summaries for newly added files with identical content at different paths', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'be-music-chart-cache-path-agnostic-'));
    const tempHome = await mkdtemp(join(tmpdir(), 'be-music-chart-cache-home-'));
    tempDirectories.push(tempRoot, tempHome);
    process.env.HOME = tempHome;

    const firstPath = join(tempRoot, 'first.bms');
    const secondPath = join(tempRoot, 'nested', 'second.bms');
    const source = ['#TITLE Shared', '#ARTIST Codex', '#PLAYER 1', '#BPM 120'].join('\n');
    await mkdir(dirname(secondPath), { recursive: true });
    await writeFile(firstPath, source);

    await buildChartSelectionEntries(tempRoot, [firstPath]);

    const parser = await import('@be-music/parser');
    const parseChartSpy = vi.spyOn(parser, 'parseChart');
    await writeFile(secondPath, source);

    const entries = await buildChartSelectionEntries(tempRoot, [firstPath, secondPath]);
    const chartEntries = entries.filter((entry) => entry.kind === 'chart');

    expect(chartEntries).toHaveLength(2);
    expect(chartEntries).toContainEqual(
      expect.objectContaining({
        kind: 'chart',
        filePath: secondPath,
        title: 'Shared',
        artist: 'Codex',
      }),
    );
    expect(parseChartSpy).not.toHaveBeenCalled();

    const cachePath = join(tempHome, '.be-music', 'chart-selection-cache.json');
    const cacheJson = JSON.parse(await readFile(cachePath, 'utf8')) as {
      entries: Record<string, unknown>;
    };
    expect(Object.keys(cacheJson.entries)).toHaveLength(1);
  });
});
