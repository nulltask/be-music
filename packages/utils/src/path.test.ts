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

  test('resolveFirstExistingPath rejects absolute candidates per the bmson spec malicious-path guard', async () => {
    // bmson 1.0.0 spec MUST: "Absolute path: C:\\password.txt or
    // /etc/passwd" must be refused. Even when the absolute path
    // sits under baseDir, the malicious-path predicate rejects
    // it pre-resolve so chart-authored absolute references can't
    // sneak through. Callers that need to load a known absolute
    // file should pass it directly to `fs.access` without going
    // through this helper.
    const baseDir = await createTempFixtureDir('absolute');
    const existingPath = join(baseDir, 'absolute.bms');
    await writeFile(existingPath, '#TITLE test\n', 'utf8');
    expect(isAbsolute(existingPath)).toBe(true);

    await expect(resolveFirstExistingPath(baseDir, [existingPath])).resolves.toBeUndefined();

    // Relative candidate for the same file resolves correctly
    // through the per-baseDir join.
    await expect(resolveFirstExistingPath(baseDir, ['absolute.bms'])).resolves.toBe(existingPath);

    await expect(resolveFirstExistingPath(baseDir, ['missing.bms'])).resolves.toBeUndefined();
  });

  test('resolveFirstExistingPath rejects parent-directory traversal candidates', async () => {
    // bmson 1.0.0 spec MUST: "Reference to parent directory:
    // ../../../var/www/html/config.php" must be refused. Even
    // a single-step `../sibling` walk escapes the chart bundle
    // and must not resolve.
    const baseDir = await createTempFixtureDir('parent-traversal');
    const sibling = join(baseDir, '..', 'sibling-secret.txt');
    await writeFile(sibling, 'secret', 'utf8');
    try {
      await expect(resolveFirstExistingPath(baseDir, ['../sibling-secret.txt'])).resolves.toBeUndefined();
    } finally {
      await rm(sibling, { force: true });
    }
  });

  test('resolveFirstExistingPath rejects null-byte injection candidates', async () => {
    // bmson 1.0.0 spec MUST: "Null characters (`\\0`)" must be
    // refused. Some native APIs interpret `\0` as a C string
    // terminator, so a crafted candidate like
    // `safe.wav\0/etc/passwd` could resolve to the second half
    // on a non-defensive backend.
    const baseDir = await createTempFixtureDir('null-byte');
    await expect(resolveFirstExistingPath(baseDir, ['safe.wav\0/etc/passwd'])).resolves.toBeUndefined();
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
    await expect(
      resolveFirstExistingPath(baseDir, ['other-missing.bms'], delayedController.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
