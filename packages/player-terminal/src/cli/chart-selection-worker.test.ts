import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vite-plus/test';
import { workerize } from '@be-music/shared-utils/workerize';
import { buildChartSelectionEntries } from './chart-selection.ts';

const fixture = vi.hoisted(() => ({ home: '' }));

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => fixture.home,
}));

vi.mock('@be-music/shared-utils/workerize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@be-music/shared-utils/workerize')>()),
  workerize: vi.fn(() =>
    Object.assign(
      (_summaries: unknown, callback: (error: unknown, entries: unknown[]) => void) => callback(undefined, []),
      {
        close: vi.fn(),
      },
    ),
  ),
}));

test('starts the selection worker only for a nonempty library and reuses it', async () => {
  fixture.home = await mkdtemp(join(tmpdir(), 'be-music-selection-worker-'));
  try {
    expect(workerize).not.toHaveBeenCalled();
    await expect(buildChartSelectionEntries(fixture.home, [])).resolves.toEqual([]);
    expect(workerize).not.toHaveBeenCalled();

    const chart = join(fixture.home, 'test.bms');
    await writeFile(chart, '#TITLE Test\n#00111:01\n');
    await buildChartSelectionEntries(fixture.home, [chart]);
    await buildChartSelectionEntries(fixture.home, [chart]);
    expect(workerize).toHaveBeenCalledTimes(1);
  } finally {
    await rm(fixture.home, { recursive: true, force: true });
  }
});
