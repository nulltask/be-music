import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { resolveFirstExistingPath } from './index.ts';

const tempDirs: string[] = [];

async function createTempFixtureDir(name: string): Promise<string> {
  const dir = join(tmpdir(), `be-music-path-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('path utilities', () => {
  test('resolveFirstExistingPath returns the first matching relative path', async () => {
    const baseDir = await createTempFixtureDir('relative');
    const nestedDir = join(baseDir, 'nested');
    const existingPath = join(nestedDir, 'chart.bms');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(existingPath, '#TITLE test\n', 'utf8');

    await expect(
      resolveFirstExistingPath(baseDir, ['missing.bms', 'nested/chart.bms', 'nested/other.bms']),
    ).resolves.toBe(existingPath);
  });

  test('resolveFirstExistingPath accepts absolute candidates and returns undefined when nothing matches', async () => {
    const baseDir = await createTempFixtureDir('absolute');
    const existingPath = join(baseDir, 'absolute.bms');
    await writeFile(existingPath, '#TITLE test\n', 'utf8');

    const resolvedAbsolute = await resolveFirstExistingPath(baseDir, [existingPath]);
    expect(resolvedAbsolute).toBe(existingPath);
    expect(isAbsolute(resolvedAbsolute!)).toBe(true);

    await expect(resolveFirstExistingPath(baseDir, ['missing.bms'])).resolves.toBeUndefined();
  });

  test('resolveFirstExistingPath rejects when the signal is already aborted or aborts during lookup', async () => {
    const baseDir = await createTempFixtureDir('abort');
    const controller = new AbortController();
    controller.abort();

    await expect(resolveFirstExistingPath(baseDir, ['missing.bms'], controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });

    const delayedController = new AbortController();
    delayedController.abort();
    await expect(resolveFirstExistingPath(baseDir, ['other-missing.bms'], delayedController.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
