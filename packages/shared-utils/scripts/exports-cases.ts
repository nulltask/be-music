import * as pngAPI from '@be-music/shared-utils/png';
import * as hashAPI from '@be-music/shared-utils/hash';
import * as asyncAPI from '@be-music/shared-utils/async';
import * as cliAPI from '@be-music/shared-utils/cli';
import * as utilsAPI from '@be-music/shared-utils';
import * as optionalNodeModuleAPI from '@be-music/shared-utils/optional-node-module';
import * as workerizeAPI from '@be-music/shared-utils/workerize';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAABnRSTlMAfwB/AH+KMzNPAAAAD0lEQVR4nGOor69n+M8AAAl2An3QNTIfAAAAAElFTkSuQmCC',
  ),
  (character) => character.charCodeAt(0),
);
const BENCH_AUDIO_PCM = Float32Array.from({ length: 4410 }, (_, index) => Math.sin(index / 20));

const caseInsensitiveFiles = new Map<string, Uint8Array>([['Song/Kick.WAV', new Uint8Array([1, 2, 3])]]);
const eagerEntry = new Uint8Array([1, 2, 3]);
const lazyEntry = {
  name: 'chart-model.bms',
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
  define('shared-utils.transformStereoPCM', {
    run: () => {
      utilsAPI.transformStereoPCM(BENCH_AUDIO_PCM, BENCH_AUDIO_PCM, 44100, 48000, {
        playbackRate: 2,
        leftGain: 0.5,
        maxDurationSeconds: 0.05,
      });
    },
  });
  define('shared-utils.resolveSampleSliceEnvelope', {
    run: () => {
      utilsAPI.resolveSampleSliceEnvelope(4410, 2205, 44100, 132);
    },
  });
  define('shared-utils.sampleSliceEnvelopeGain', {
    run: () => {
      utilsAPI.sampleSliceEnvelopeGain(2250, 2205, { fadeIn: 132, fadeOut: 132 });
    },
  });
  define('shared-utils.png.decodePNGToRGBA8', {
    run: () => {
      pngAPI.decodePNGToRGBA8(BENCH_PNG);
    },
  });
  define('shared-utils.resolveCLIPath', {
    run: () => {
      utilsAPI.resolveCLIPath('./assets/sample.wav', '/tmp/bench');
    },
  });
  define('shared-utils.clamp', {
    run: () => {
      utilsAPI.clamp(1.25, -1, 1);
    },
  });
  define('shared-utils.clampSignedUnit', {
    run: () => {
      utilsAPI.clampSignedUnit(1.5);
    },
  });
  define('shared-utils.floatToInt16', {
    run: () => {
      utilsAPI.floatToInt16(-0.87);
    },
  });
  define('shared-utils.normalizeNonNegativeInt', {
    run: () => {
      utilsAPI.normalizeNonNegativeInt(12.9, 3);
    },
  });
  define('shared-utils.normalizePositiveInt', {
    run: () => {
      utilsAPI.normalizePositiveInt(12.9, 3);
    },
  });
  define('shared-utils.normalizeFractionNumerator', {
    run: () => {
      utilsAPI.normalizeFractionNumerator(5.4, 16, 0);
    },
  });
  define('shared-utils.gcd', {
    run: () => {
      utilsAPI.gcd(1_048_576, 36_000);
    },
  });
  define('shared-utils.lcm', {
    run: () => {
      utilsAPI.lcm(960, 1400);
    },
  });
  define('shared-utils.compareFractions', {
    run: () => {
      utilsAPI.compareFractions(3, 8, 5, 16);
    },
  });
  define('shared-utils.normalizeSortedUniqueNonNegativeIntegers', {
    run: () => {
      utilsAPI.normalizeSortedUniqueNonNegativeIntegers([9, 3, 9, 3, 12, Number.NaN, -3, 4.9]);
    },
  });
  define('shared-utils.findLastIndexAtOrBefore', {
    run: (fixtures) => {
      utilsAPI.findLastIndexAtOrBefore(fixtures.fractionItems, 377, (item) => item.value);
    },
  });
  define('shared-utils.findLastIndexBefore', {
    run: (fixtures) => {
      utilsAPI.findLastIndexBefore(fixtures.fractionItems, 377, (item) => item.value);
    },
  });
  define('shared-utils.findFirstIndexAtOrAfter', {
    run: (fixtures) => {
      utilsAPI.findFirstIndexAtOrAfter(fixtures.fractionItems, 377, (item) => item.value);
    },
  });
  define('shared-utils.findFirstIndexNumberAtOrAfter', {
    run: (fixtures) => {
      utilsAPI.findFirstIndexNumberAtOrAfter(fixtures.fractionValues, 377);
    },
  });
  define('shared-utils.runWithConcurrency', {
    run: async () => {
      await utilsAPI.runWithConcurrency([1, 2, 3, 4], 2, async () => undefined);
    },
  });
  define('shared-utils.findCaseInsensitiveMapPath', {
    run: () => {
      utilsAPI.findCaseInsensitiveMapPath(caseInsensitiveFiles, 'song/kick.wav');
    },
  });
  define('shared-utils.lookupCaseInsensitiveMapEntry', {
    run: () => {
      utilsAPI.lookupCaseInsensitiveMapEntry(caseInsensitiveFiles, 'SONG/KICK.WAV');
    },
  });
  define('shared-utils.loadFileEntryBytes', {
    run: async () => {
      await utilsAPI.loadFileEntryBytes(eagerEntry);
    },
  });
  define('shared-utils.asLoadedFileEntryBytes', {
    run: () => {
      utilsAPI.asLoadedFileEntryBytes(eagerEntry);
    },
  });
  define('shared-utils.readFilesIntoEntryMap', {
    ioBound: true,
    run: async () => {
      await utilsAPI.readFilesIntoEntryMap([lazyEntry], { deferAudio: false });
    },
  });
  define('shared-utils.normalizeASCIIBase36Code', {
    run: () => {
      utilsAPI.normalizeASCIIBase36Code(0x66);
    },
  });
  define('shared-utils.normalizeASCIIBase62Code', {
    run: () => {
      utilsAPI.normalizeASCIIBase62Code(0x7a);
    },
  });
  define('shared-utils.normalizePath', {
    run: () => {
      utilsAPI.normalizePath(String.raw`Songs\\set/../chart-model/./main.bms`);
    },
  });
  define('shared-utils.dirname', {
    run: () => {
      utilsAPI.dirname(String.raw`Songs\\chart/main.bms`);
    },
  });
  define('shared-utils.basename', {
    run: () => {
      utilsAPI.basename(String.raw`Songs\\chart/main.bms`);
    },
  });
  define('shared-utils.extname', {
    run: () => {
      utilsAPI.extname(String.raw`Songs\\chart/main.bms`);
      utilsAPI.extname('README');
    },
  });
  define('shared-utils.createAbortError', {
    run: () => {
      utilsAPI.createAbortError();
    },
  });
  define('shared-utils.createFileLogger', {
    ioBound: true,
    run: async (fixtures) => {
      const logger = await utilsAPI.createFileLogger(`${fixtures.tmpDir}/bench-log.ndjson`);
      await logger.close();
    },
  });
  define('shared-utils.createNoopLogger', {
    run: async () => {
      const logger = utilsAPI.createNoopLogger();
      logger.log({
        source: 'bench',
        level: 'debug',
        event: 'shared-utils.createNoopLogger',
      });
      await logger.close();
    },
  });
  define('shared-utils.isAbortError', {
    run: () => {
      utilsAPI.isAbortError(new Error('x'));
    },
  });
  define('shared-utils.isMaliciousAssetPath', {
    run: () => {
      utilsAPI.isMaliciousAssetPath('../../../etc/passwd');
      utilsAPI.isMaliciousAssetPath('sounds/kick.wav');
    },
  });
  define('shared-utils.isAudioAssetPath', {
    run: () => {
      utilsAPI.isAudioAssetPath('sounds/kick.wav');
      utilsAPI.isAudioAssetPath('images/title.png');
    },
  });
  define('shared-utils.throwIfAborted', {
    run: () => {
      utilsAPI.throwIfAborted(undefined);
    },
  });
  define('shared-utils.resolveFirstExistingPath', {
    ioBound: true,
    run: async (fixtures) => {
      await utilsAPI.resolveFirstExistingPath(fixtures.tmpDir, ['missing.wav', 'missing.ogg']);
    },
  });
  define('shared-utils.writeStereoPCM16LE', {
    run: (fixtures) => {
      const buffer = Buffer.allocUnsafe(16);
      utilsAPI.writeStereoPCM16LE(buffer, 0, fixtures.sampleRenderResult.left, fixtures.sampleRenderResult.right, 0, 4);
    },
  });
  define('shared-utils.writeStereoPCM16BE', {
    run: (fixtures) => {
      const buffer = Buffer.allocUnsafe(16);
      utilsAPI.writeStereoPCM16BE(buffer, 0, fixtures.sampleRenderResult.left, fixtures.sampleRenderResult.right, 0, 4);
    },
  });

  // `@be-music/shared-utils/optional-node-module` (Node only)
  define('shared-utils.optional-node-module.loadOptionalNodeModule', {
    run: async () => {
      // The import succeeds; then the SEA path, where it fails and `createRequire` finds the module instead. A built-in
      // stands in for the optional package so the fallback resolves without touching the disk.
      await optionalNodeModuleAPI.loadOptionalNodeModule('node:path', () => import('node:path'));
      await optionalNodeModuleAPI.loadOptionalNodeModule('node:path', failSEAImport);
    },
  });

  // `@be-music/shared-utils/workerize` (Node only)
  define('shared-utils.workerize.workerize', {
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
  define('shared-utils.workerize.invokeWorkerizedFunction', {
    run: async () => {
      await workerizeAPI.invokeWorkerizedFunction(inlineWorker, [41], { signal: workerAbortController.signal });
    },
  });
  define('shared-utils.hash.sha256Hex', {
    run: () => {
      hashAPI.sha256Hex('Be-Music benchmark');
    },
  });
  define('shared-utils.hash.sha256HexOfBytes', {
    run: () => {
      hashAPI.sha256HexOfBytes(eagerEntry);
    },
  });
  define('shared-utils.hash.sha256HexAsync', {
    run: async () => {
      await hashAPI.sha256HexAsync(eagerEntry);
    },
  });
  define('shared-utils.async.settleWithTimeout', {
    run: async () => {
      await asyncAPI.settleWithTimeout(Promise.resolve(), 100);
    },
  });
  define('shared-utils.cli.isCLIEntryPoint', {
    run: () => {
      cliAPI.isCLIEntryPoint(() => import.meta.url);
    },
  });
}
