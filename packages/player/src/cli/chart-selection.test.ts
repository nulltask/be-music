import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import { listChartFiles } from './chart-selection.ts';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })),
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
});
