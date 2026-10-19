import * as utilsApi from '@be-music/utils';
import * as optionalNodeModuleApi from '@be-music/utils/optional-node-module';
import * as workerizeApi from '@be-music/utils/workerize';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const caseInsensitiveFiles = new Map<string, Uint8Array>([['Song/Kick.WAV', new Uint8Array([1, 2, 3])]]);
const eagerEntry = new Uint8Array([1, 2, 3]);
const lazyEntry = {
  name: 'chart.bms',
  webkitRelativePath: 'Song/chart.bms',
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
};
// What `import()` throws for a bare specifier inside a Node single executable application.
const seaImportError = Object.assign(new Error('No such built-in module: node-web-audio-api'), {
  code: 'ERR_UNKNOWN_BUILTIN_MODULE',
});
const failSeaImport = (): Promise<never> => Promise.reject(seaImportError);
// A worker that answers in the calling thread, so the case measures the promise and abort wiring, not a thread hop.
const inlineWorker = Object.assign(
  (value: number, callback: (error: unknown, result: number) => void) => {
    callback(undefined, value + 1);
  },
  { close: () => {} },
);
const workerAbortController = new AbortController();

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
  define('utils.findFirstIndexAtOrAfter', {
    run: (fixtures) => {
      utilsApi.findFirstIndexAtOrAfter(fixtures.fractionItems, 377, (item) => item.value);
    },
  });
  define('utils.findFirstIndexNumberAtOrAfter', {
    run: (fixtures) => {
      utilsApi.findFirstIndexNumberAtOrAfter(fixtures.fractionValues, 377);
    },
  });
  define('utils.runWithConcurrency', {
    run: async () => {
      await utilsApi.runWithConcurrency([1, 2, 3, 4], 2, async () => undefined);
    },
  });
  define('utils.findCaseInsensitiveMapPath', {
    run: () => {
      utilsApi.findCaseInsensitiveMapPath(caseInsensitiveFiles, 'song/kick.wav');
    },
  });
  define('utils.lookupCaseInsensitiveMapEntry', {
    run: () => {
      utilsApi.lookupCaseInsensitiveMapEntry(caseInsensitiveFiles, 'SONG/KICK.WAV');
    },
  });
  define('utils.loadFileEntryBytes', {
    run: async () => {
      await utilsApi.loadFileEntryBytes(eagerEntry);
    },
  });
  define('utils.asLoadedFileEntryBytes', {
    run: () => {
      utilsApi.asLoadedFileEntryBytes(eagerEntry);
    },
  });
  define('utils.readFilesIntoEntryMap', {
    ioBound: true,
    run: async () => {
      await utilsApi.readFilesIntoEntryMap([lazyEntry], { deferAudio: false });
    },
  });
  define('utils.normalizeAsciiBase36Code', {
    run: () => {
      utilsApi.normalizeAsciiBase36Code(0x66);
    },
  });
  define('utils.normalizeAsciiBase62Code', {
    run: () => {
      utilsApi.normalizeAsciiBase62Code(0x7a);
    },
  });
  define('utils.normalizePath', {
    run: () => {
      utilsApi.normalizePath(String.raw`Songs\\set/../chart/./main.bms`);
    },
  });
  define('utils.dirname', {
    run: () => {
      utilsApi.dirname(String.raw`Songs\\chart/main.bms`);
    },
  });
  define('utils.basename', {
    run: () => {
      utilsApi.basename(String.raw`Songs\\chart/main.bms`);
    },
  });
  define('utils.extname', {
    run: () => {
      utilsApi.extname(String.raw`Songs\\chart/main.bms`);
      utilsApi.extname('README');
    },
  });
  define('utils.createAbortError', {
    run: () => {
      utilsApi.createAbortError();
    },
  });
  define('utils.createFileLogger', {
    ioBound: true,
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
  define('utils.isMaliciousAssetPath', {
    run: () => {
      utilsApi.isMaliciousAssetPath('../../../etc/passwd');
      utilsApi.isMaliciousAssetPath('sounds/kick.wav');
    },
  });
  define('utils.isAudioAssetPath', {
    run: () => {
      utilsApi.isAudioAssetPath('sounds/kick.wav');
      utilsApi.isAudioAssetPath('images/title.png');
    },
  });
  define('utils.throwIfAborted', {
    run: () => {
      utilsApi.throwIfAborted(undefined);
    },
  });
  define('utils.resolveFirstExistingPath', {
    ioBound: true,
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

  // `@be-music/utils/optional-node-module` (Node only)
  define('utils.optional-node-module.loadOptionalNodeModule', {
    run: async () => {
      // The import succeeds; then the SEA path, where it fails and `createRequire` finds the module instead. A built-in
      // stands in for the optional package so the fallback resolves without touching the disk.
      await optionalNodeModuleApi.loadOptionalNodeModule('node:path', () => import('node:path'));
      await optionalNodeModuleApi.loadOptionalNodeModule('node:path', failSeaImport);
    },
  });

  // `@be-music/utils/workerize` (Node only)
  define('utils.workerize.workerize', {
    // Starts a worker thread, runs one call on it and stops it: the time follows the thread start-up more than the code.
    ioBound: true,
    run: async () => {
      const worker = workerizeApi.workerize(
        (value: number) => value + 1,
        () => [],
      );
      try {
        await workerizeApi.invokeWorkerizedFunction(worker, [41]);
      } finally {
        worker.close();
      }
    },
  });
  define('utils.workerize.invokeWorkerizedFunction', {
    run: async () => {
      await workerizeApi.invokeWorkerizedFunction(inlineWorker, [41], { signal: workerAbortController.signal });
    },
  });
}
