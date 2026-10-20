import * as utilsAPI from '@be-music/utils';
import * as optionalNodeModuleAPI from '@be-music/utils/optional-node-module';
import * as workerizeAPI from '@be-music/utils/workerize';
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
const failSEAImport = (): Promise<never> => Promise.reject(seaImportError);
// A worker that answers in the calling thread, so the case measures the promise and abort wiring, not a thread hop.
const inlineWorker = Object.assign(
  (value: number, callback: (error: unknown, result: number) => void) => {
    callback(undefined, value + 1);
  },
  { close: () => {} },
);
const workerAbortController = new AbortController();

export function registerUtilsExportsCases(define: DefineBenchmarkCase): void {
  define('utils.resolveCLIPath', {
    run: () => {
      utilsAPI.resolveCLIPath('./assets/sample.wav', '/tmp/bench');
    },
  });
  define('utils.clamp', {
    run: () => {
      utilsAPI.clamp(1.25, -1, 1);
    },
  });
  define('utils.clampSignedUnit', {
    run: () => {
      utilsAPI.clampSignedUnit(1.5);
    },
  });
  define('utils.floatToInt16', {
    run: () => {
      utilsAPI.floatToInt16(-0.87);
    },
  });
  define('utils.normalizeNonNegativeInt', {
    run: () => {
      utilsAPI.normalizeNonNegativeInt(12.9, 3);
    },
  });
  define('utils.normalizePositiveInt', {
    run: () => {
      utilsAPI.normalizePositiveInt(12.9, 3);
    },
  });
  define('utils.normalizeFractionNumerator', {
    run: () => {
      utilsAPI.normalizeFractionNumerator(5.4, 16, 0);
    },
  });
  define('utils.gcd', {
    run: () => {
      utilsAPI.gcd(1_048_576, 36_000);
    },
  });
  define('utils.lcm', {
    run: () => {
      utilsAPI.lcm(960, 1400);
    },
  });
  define('utils.compareFractions', {
    run: () => {
      utilsAPI.compareFractions(3, 8, 5, 16);
    },
  });
  define('utils.normalizeSortedUniqueNonNegativeIntegers', {
    run: () => {
      utilsAPI.normalizeSortedUniqueNonNegativeIntegers([9, 3, 9, 3, 12, Number.NaN, -3, 4.9]);
    },
  });
  define('utils.findLastIndexAtOrBefore', {
    run: (fixtures) => {
      utilsAPI.findLastIndexAtOrBefore(fixtures.fractionItems, 377, (item) => item.value);
    },
  });
  define('utils.findLastIndexBefore', {
    run: (fixtures) => {
      utilsAPI.findLastIndexBefore(fixtures.fractionItems, 377, (item) => item.value);
    },
  });
  define('utils.findFirstIndexAtOrAfter', {
    run: (fixtures) => {
      utilsAPI.findFirstIndexAtOrAfter(fixtures.fractionItems, 377, (item) => item.value);
    },
  });
  define('utils.findFirstIndexNumberAtOrAfter', {
    run: (fixtures) => {
      utilsAPI.findFirstIndexNumberAtOrAfter(fixtures.fractionValues, 377);
    },
  });
  define('utils.runWithConcurrency', {
    run: async () => {
      await utilsAPI.runWithConcurrency([1, 2, 3, 4], 2, async () => undefined);
    },
  });
  define('utils.findCaseInsensitiveMapPath', {
    run: () => {
      utilsAPI.findCaseInsensitiveMapPath(caseInsensitiveFiles, 'song/kick.wav');
    },
  });
  define('utils.lookupCaseInsensitiveMapEntry', {
    run: () => {
      utilsAPI.lookupCaseInsensitiveMapEntry(caseInsensitiveFiles, 'SONG/KICK.WAV');
    },
  });
  define('utils.loadFileEntryBytes', {
    run: async () => {
      await utilsAPI.loadFileEntryBytes(eagerEntry);
    },
  });
  define('utils.asLoadedFileEntryBytes', {
    run: () => {
      utilsAPI.asLoadedFileEntryBytes(eagerEntry);
    },
  });
  define('utils.readFilesIntoEntryMap', {
    ioBound: true,
    run: async () => {
      await utilsAPI.readFilesIntoEntryMap([lazyEntry], { deferAudio: false });
    },
  });
  define('utils.normalizeASCIIBase36Code', {
    run: () => {
      utilsAPI.normalizeASCIIBase36Code(0x66);
    },
  });
  define('utils.normalizeASCIIBase62Code', {
    run: () => {
      utilsAPI.normalizeASCIIBase62Code(0x7a);
    },
  });
  define('utils.normalizePath', {
    run: () => {
      utilsAPI.normalizePath(String.raw`Songs\\set/../chart/./main.bms`);
    },
  });
  define('utils.dirname', {
    run: () => {
      utilsAPI.dirname(String.raw`Songs\\chart/main.bms`);
    },
  });
  define('utils.basename', {
    run: () => {
      utilsAPI.basename(String.raw`Songs\\chart/main.bms`);
    },
  });
  define('utils.extname', {
    run: () => {
      utilsAPI.extname(String.raw`Songs\\chart/main.bms`);
      utilsAPI.extname('README');
    },
  });
  define('utils.createAbortError', {
    run: () => {
      utilsAPI.createAbortError();
    },
  });
  define('utils.createFileLogger', {
    ioBound: true,
    run: async (fixtures) => {
      const logger = await utilsAPI.createFileLogger(`${fixtures.tmpDir}/bench-log.ndjson`);
      await logger.close();
    },
  });
  define('utils.createNoopLogger', {
    run: async () => {
      const logger = utilsAPI.createNoopLogger();
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
      utilsAPI.isAbortError(new Error('x'));
    },
  });
  define('utils.isMaliciousAssetPath', {
    run: () => {
      utilsAPI.isMaliciousAssetPath('../../../etc/passwd');
      utilsAPI.isMaliciousAssetPath('sounds/kick.wav');
    },
  });
  define('utils.isAudioAssetPath', {
    run: () => {
      utilsAPI.isAudioAssetPath('sounds/kick.wav');
      utilsAPI.isAudioAssetPath('images/title.png');
    },
  });
  define('utils.throwIfAborted', {
    run: () => {
      utilsAPI.throwIfAborted(undefined);
    },
  });
  define('utils.resolveFirstExistingPath', {
    ioBound: true,
    run: async (fixtures) => {
      await utilsAPI.resolveFirstExistingPath(fixtures.tmpDir, ['missing.wav', 'missing.ogg']);
    },
  });
  define('utils.writeStereoPcm16LE', {
    run: (fixtures) => {
      const buffer = Buffer.allocUnsafe(16);
      utilsAPI.writeStereoPcm16LE(buffer, 0, fixtures.sampleRenderResult.left, fixtures.sampleRenderResult.right, 0, 4);
    },
  });
  define('utils.writeStereoPcm16BE', {
    run: (fixtures) => {
      const buffer = Buffer.allocUnsafe(16);
      utilsAPI.writeStereoPcm16BE(buffer, 0, fixtures.sampleRenderResult.left, fixtures.sampleRenderResult.right, 0, 4);
    },
  });

  // `@be-music/utils/optional-node-module` (Node only)
  define('utils.optional-node-module.loadOptionalNodeModule', {
    run: async () => {
      // The import succeeds; then the SEA path, where it fails and `createRequire` finds the module instead. A built-in
      // stands in for the optional package so the fallback resolves without touching the disk.
      await optionalNodeModuleAPI.loadOptionalNodeModule('node:path', () => import('node:path'));
      await optionalNodeModuleAPI.loadOptionalNodeModule('node:path', failSEAImport);
    },
  });

  // `@be-music/utils/workerize` (Node only)
  define('utils.workerize.workerize', {
    // Starts a worker thread, runs one call on it and stops it: the time follows the thread start-up more than the code.
    ioBound: true,
    run: async () => {
      const worker = workerizeAPI.workerize(
        (value: number) => value + 1,
        () => [],
      );
      try {
        await workerizeAPI.invokeWorkerizedFunction(worker, [41]);
      } finally {
        worker.close();
      }
    },
  });
  define('utils.workerize.invokeWorkerizedFunction', {
    run: async () => {
      await workerizeAPI.invokeWorkerizedFunction(inlineWorker, [41], { signal: workerAbortController.signal });
    },
  });
}
