import * as utilsApi from '@be-music/utils';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerUtilsExportsCases(define: DefineBenchmarkCase): void {
  define('utils.resolveCliPath', {
    run: () => {
      utilsApi.resolveCliPath('./assets/sample.wav', '/tmp/bench');
    },
  });
  define('utils.clamp', {
    run: () => {
      utilsApi.clamp(1.25, -1, 1);
    },
  });
  define('utils.clampSignedUnit', {
    run: () => {
      utilsApi.clampSignedUnit(1.5);
    },
  });
  define('utils.floatToInt16', {
    run: () => {
      utilsApi.floatToInt16(-0.87);
    },
  });
  define('utils.normalizeNonNegativeInt', {
    run: () => {
      utilsApi.normalizeNonNegativeInt(12.9, 3);
    },
  });
  define('utils.normalizePositiveInt', {
    run: () => {
      utilsApi.normalizePositiveInt(12.9, 3);
    },
  });
  define('utils.normalizeFractionNumerator', {
    run: () => {
      utilsApi.normalizeFractionNumerator(5.4, 16, 0);
    },
  });
  define('utils.gcd', {
    run: () => {
      utilsApi.gcd(1_048_576, 36_000);
    },
  });
  define('utils.lcm', {
    run: () => {
      utilsApi.lcm(960, 1400);
    },
  });
  define('utils.compareFractions', {
    run: () => {
      utilsApi.compareFractions(3, 8, 5, 16);
    },
  });
  define('utils.normalizeSortedUniqueNonNegativeIntegers', {
    run: () => {
      utilsApi.normalizeSortedUniqueNonNegativeIntegers([9, 3, 9, 3, 12, Number.NaN, -3, 4.9]);
    },
  });
  define('utils.findLastIndexAtOrBefore', {
    run: (fixtures) => {
      utilsApi.findLastIndexAtOrBefore(fixtures.fractionItems, 377, (item) => item.value);
    },
  });
  define('utils.findLastIndexBefore', {
    run: (fixtures) => {
      utilsApi.findLastIndexBefore(fixtures.fractionItems, 377, (item) => item.value);
    },
  });
  define('utils.normalizeAsciiBase36Code', {
    run: () => {
      utilsApi.normalizeAsciiBase36Code(0x66);
    },
  });
  define('utils.workerize', {
    run: () => {
      const worker = utilsApi.workerize((value: number) => value + 1, () => []);
      worker.close();
    },
  });
  define('utils.invokeWorkerizedFunction', {
    run: async () => {
      const worker = utilsApi.workerize((value: number) => value + 1, () => []);
      try {
        await utilsApi.invokeWorkerizedFunction(worker, [41]);
      } finally {
        worker.close();
      }
    },
  });
  define('utils.createAbortError', {
    run: () => {
      utilsApi.createAbortError();
    },
  });
  define('utils.createFileLogger', {
    run: async (fixtures) => {
      const logger = await utilsApi.createFileLogger(`${fixtures.tmpDir}/bench-log.ndjson`);
      await logger.close();
    },
  });
  define('utils.createNoopLogger', {
    run: async () => {
      const logger = utilsApi.createNoopLogger();
      logger.log({
        source: 'bench',
        level: 'debug',
        event: 'utils.createNoopLogger',
      });
      await logger.close();
    },
  });
  define('utils.isAbortError', {
    run: () => {
      utilsApi.isAbortError(new Error('x'));
    },
  });
  define('utils.throwIfAborted', {
    run: () => {
      utilsApi.throwIfAborted(undefined);
    },
  });
  define('utils.resolveFirstExistingPath', {
    run: async (fixtures) => {
      await utilsApi.resolveFirstExistingPath(fixtures.tmpDir, ['missing.wav', 'missing.ogg']);
    },
  });
  define('utils.writeStereoPcm16Le', {
    run: (fixtures) => {
      const buffer = Buffer.allocUnsafe(16);
      utilsApi.writeStereoPcm16Le(buffer, 0, fixtures.sampleRenderResult.left, fixtures.sampleRenderResult.right, 0, 4);
    },
  });
  define('utils.writeStereoPcm16Be', {
    run: (fixtures) => {
      const buffer = Buffer.allocUnsafe(16);
      utilsApi.writeStereoPcm16Be(buffer, 0, fixtures.sampleRenderResult.left, fixtures.sampleRenderResult.right, 0, 4);
    },
  });
}
