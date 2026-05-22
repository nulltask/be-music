import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolvePackageBenchmarkOutputPath } from './package-cli.ts';

describe('resolvePackageBenchmarkOutputPath', () => {
  it('uses the repository tmp/bench path for a package script', () => {
    const packageScriptPath = resolve('/repo/packages/chart/scripts/bench.ts');

    expect(resolvePackageBenchmarkOutputPath(pathToFileURL(packageScriptPath).href, 'chart')).toBe(
      resolve('/repo/tmp/bench/exports-chart.json'),
    );
  });
});
