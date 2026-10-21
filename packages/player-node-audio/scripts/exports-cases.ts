import { resolveChart } from '@be-music/chart-model';
import { createEmptyJSON } from '@be-music/chart-source';
import { createNodeAudioSession, loadNodeAudioSampleDurations } from '@be-music/player-node-audio';
import * as audioSinkAPI from '@be-music/player-node-audio/audio-sink';
import type { WebAudioContextLike } from '@be-music/player-node-audio/audio-sink';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';
export function registerNodeAudioExportsCases(define: DefineBenchmarkCase): void {
  registerAudioSinkCases(define);
  define('player-node-audio.createNodeAudioSession', {
    interactive: true,
    run: async () => {
      const json = createEmptyJSON('bms');
      const session = await createNodeAudioSession({
        json,
        resolvedChart: resolveChart(json),
        options: { writeOutput: () => undefined },
        mode: 'auto',
      });
      await session?.dispose();
    },
  });
  define('player-node-audio.loadNodeAudioSampleDurations', {
    run: async () => {
      await loadNodeAudioSampleDurations(resolveChart(createEmptyJSON('bms')));
    },
  });
}
/** `@be-music/player-node-audio/audio-sink`: the PCM sinks over Web Audio. */
function registerAudioSinkCases(define: DefineBenchmarkCase): void {
  define('player-node-audio.audio-sink.createBrowserAudioSink', {
    run: () => {
      const sink = audioSinkAPI.createBrowserAudioSink(createBenchAudioContext(), {
        sampleRate: 44_100,
        channels: 2,
        samplesPerFrame: 512,
        mode: 'manual',
      });
      sink.write(BENCH_PCM_CHUNK);
      sink.getClockState();
    },
  });
  define('player-node-audio.audio-sink.createNodeAudioSink', {
    // Opens the machine's audio output through node-web-audio-api.
    run: async () => {
      const sink = await audioSinkAPI.createNodeAudioSink({
        sampleRate: 44_100,
        channels: 2,
        samplesPerFrame: 512,
        mode: 'manual',
      });
      sink?.destroy();
    },
    interactive: true,
  });
}

const BENCH_PCM_CHUNK = new Uint8Array(new Int16Array(1024).buffer);

function createBenchAudioContext(): WebAudioContextLike {
  return {
    currentTime: 0,
    destination: {},
    createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => ({ buffer: null, connect: () => undefined, start: () => undefined }),
    suspend: async () => undefined,
    resume: async () => undefined,
  };
}
