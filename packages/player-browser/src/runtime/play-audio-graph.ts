// A play's own audio graph: its `interactive` AudioContext and the bus every chart sample plays through. The audio
// service opens it for a play (`openPlayGraph`, ADR 0007), and a play without the service builds it directly; the
// chart's samples are decoded into it by `chart/play-audio.ts`.

import { volWAVToLinearGain } from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';
import { logger } from '../logger.ts';
import { buildAudioBus, type AudioBusHandle, type BuildAudioBusOptions, type CompressorMode } from './audio-bus.ts';

const log = logger('play-audio');

/** A play's audio graph: its own AudioContext and the bus every chart sample plays through. */
export interface PlayAudioGraph {
  audioContext: AudioContext;
  audioBus: AudioBusHandle;
}

/**
 * Builds a play's AudioContext and audio bus, with the chart's `#VOLWAV` master volume applied (only for 0 < n < 200,
 * as beatoraja does; other charts stay at unity), so every sample and the recorder see the post-`#VOLWAV` mix.
 */
export function createPlayAudioGraph(
  chart: BeMusicJSON,
  compressorMode: CompressorMode,
  busOptions?: BuildAudioBusOptions,
): PlayAudioGraph {
  // `interactive` asks for the lowest round-trip latency: keypress → audible sample is what a rhythm game feels.
  const audioContext = new AudioContext({ latencyHint: 'interactive' });
  // Most browsers start a context suspended, and its first `node.start()` then waits while the graph ramps up. We are
  // inside the gesture chain that started the play, so resuming now pre-warms it; a refusal is harmless.
  void audioContext.resume().catch(() => undefined);
  log.info('AudioContext ready', {
    sampleRate: audioContext.sampleRate,
    state: audioContext.state,
    baseLatencyMs: typeof audioContext.baseLatency === 'number' ? +(audioContext.baseLatency * 1000).toFixed(2) : 'n/a',
    outputLatencyMs:
      typeof audioContext.outputLatency === 'number' ? +(audioContext.outputLatency * 1000).toFixed(2) : 'n/a',
  });
  const audioBus = buildAudioBus(audioContext, compressorMode, busOptions);
  audioBus.setMasterGain(volWAVToLinearGain(chart.bms.volWAV));
  return { audioContext, audioBus };
}
