import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { main } from './runner.ts';

const settingsHome = vi.hoisted(() => ({ directory: '' }));
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => settingsHome.directory,
}));

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'be-music-cli-test-'));
  settingsHome.directory = root;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function run(...args: string[]): Promise<{ stdout: string; exitCode: typeof process.exitCode }> {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const output: string[] = [];
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output.push(String(chunk));
    return true;
  });
  try {
    process.argv = [process.execPath, 'bms-player', ...args];
    process.exitCode = 0;
    await main();
    return { stdout: output.join(''), exitCode: process.exitCode };
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    write.mockRestore();
  }
}

test('reports an unknown ruleset as an error with usage', async () => {
  const result = await run('chart.bms', '--ruleset', 'not-a-ruleset');
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain('Unknown --ruleset "not-a-ruleset"');
  expect(result.stdout).toContain('Usage:');
});

test('reports an empty chart library with a nonzero exit code', async () => {
  const library = join(root, 'library');
  await mkdir(library);
  await writeFile(join(library, 'readme.txt'), 'No charts yet');
  const result = await run(library);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain(`No chart files found in directory: ${library}`);
  expect(result.stdout).not.toContain('Selected chart:');
});

test('autoplays the first chart of a directory in a pipe and remembers the chart and hi-speed', async () => {
  const library = join(root, 'library');
  await mkdir(library);
  const first = join(library, 'a-first.bms');
  await writeFile(first, '#TITLE First\n#BPM 120\n#WAV01 key.wav\n#00111:0101\n');
  await writeFile(join(library, 'b-second.bms'), '#TITLE Second\n#BPM 120\n#WAV01 key.wav\n#00111:01\n');
  const result = await run(library, '--auto', '--no-tui', '--no-audio', '--high-speed', '2.5');
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(`Selected chart: ${first}`);
  expect(result.stdout).toMatch(/EX-SCORE:\s*4\s*\/\s*4/);
  expect(result.stdout).not.toContain('b-second.bms');

  const config = JSON.parse(await readFile(join(root, '.be-music', 'player.json'), 'utf8'));
  expect(config).toMatchObject({
    playMode: 'auto',
    highSpeed: 2.5,
    lastSelectedChartFileByDirectory: { [resolve(library)]: first },
  });
}, 15_000);
