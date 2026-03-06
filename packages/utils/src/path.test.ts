import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { resolveFirstExistingPath } from './index.ts';

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

test('resolveFirstExistingPath: returns the first existing candidate resolved from baseDir', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'be-music-utils-path-'));
  createdDirs.push(directory);
  const targetPath = join(directory, 'sample.wav');
  await writeFile(targetPath, 'ok', 'utf8');

  await expect(resolveFirstExistingPath(directory, ['missing.wav', 'sample.wav'])).resolves.toBe(targetPath);
});

test('resolveFirstExistingPath: propagates AbortError when already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(resolveFirstExistingPath('/tmp', ['sample.wav'], controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
});
