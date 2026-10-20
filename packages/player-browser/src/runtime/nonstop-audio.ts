import type { NonstopFade, NonstopStitchMap, NonstopStitchStage } from '@be-music/player-engine/course';
import { chartToElapsedSeconds } from './play-tempo.ts';

/**
 * How a {@link createWebAudioSession} session plays a stitched NONSTOP chart's samples: which stage a stitched WAV key
 * belongs to, the playback rate of that stage's samples on top of the play tempo (FIT changes their pitch), and where a stage's background sound
 * goes so its fades apply.
 */
export interface WebAudioStageMixer {
  stageOf(sampleKey: string): number | undefined;
  rate(stage: number): number;
  /** The node a stage's background (non-lane) voices connect to; `undefined` leaves them on the BGM bus. */
  bgmInput(stage: number): AudioNode | undefined;
}

/** A {@link WebAudioStageMixer} that owns one gain per stage and schedules the stage fades. */
export interface NonstopStageMixer extends WebAudioStageMixer {
  /**
   * Schedules every stage's fades against the chart's t=0 on the audio-context clock. Call once playback starts; a
   * suspended context (pause) holds the automation with it.
   */
  schedule(chartStartContextTime: number): void;
  /**
   * Schedules the fades again after a live tempo change: from `nowChartSeconds` on, chart second `s` falls at
   * `contextTimeAt(s)` on the audio-context clock. A fade under way carries on from where it is.
   */
  retime(nowChartSeconds: number, contextTimeAt: (chartSeconds: number) => number): void;
  dispose(): void;
}

/**
 * The gain curve of an LR2 stage fade: LR2 ramps the volume linearly and applies its square (OpenLR2 `LR2f.cpp`
 * L12579-L12605, L29040), so a fade-in rises as `t²` and a fade-out falls as `(1 − t)²`.
 */
export function nonstopFadeCurve(direction: 'in' | 'out', samples = 64, fromProgress = 0): Float32Array {
  const curve = new Float32Array(Math.max(2, samples));
  const from = Math.min(1, Math.max(0, fromProgress));
  for (let index = 0; index < curve.length; index += 1) {
    const t = from + (index / (curve.length - 1)) * (1 - from);
    const volume = direction === 'in' ? t : 1 - t;
    curve[index] = volume * volume;
  }
  return curve;
}

/** How far chart second `seconds` is through `window`, 0 to 1. */
function fadeProgress(window: NonstopFade, seconds: number): number {
  if (!(window.end > window.start)) return seconds >= window.end ? 1 : 0;
  return Math.min(1, Math.max(0, (seconds - window.start) / (window.end - window.start)));
}

/**
 * The gain of a stage's background sound at chart second `seconds`: the square of its fade-in's progress and of what
 * is left of its fade-out ({@link nonstopFadeCurve}), 1 outside them.
 */
export function nonstopStageGainAt(
  stage: Pick<NonstopStitchStage, 'soundFadeIn' | 'soundFadeOut'>,
  seconds: number,
): number {
  let gain = 1;
  if (stage.soundFadeIn !== undefined) gain *= fadeProgress(stage.soundFadeIn, seconds) ** 2;
  if (stage.soundFadeOut !== undefined) gain *= (1 - fadeProgress(stage.soundFadeOut, seconds)) ** 2;
  return gain;
}

/**
 * One gain per stage of a stitched NONSTOP chart, between the stage's background voices and `destination` (the BGM
 * bus). A stage with a fade-in starts silent, as LR2 starts that stage's BGM channel at 0; keysounds of the player's
 * lanes are not faded. `keepPitch`: the samples were stretched to their stage's rate already, so they play at rate 1
 * (`resolveSampleStretchRates`). `tempo`: the play tempo, which the fades (in chart seconds) are scheduled at.
 */
export function createNonstopStageMixer(
  audioContext: BaseAudioContext,
  destination: AudioNode,
  map: NonstopStitchMap,
  options: { keepPitch?: boolean; tempo?: number } = {},
): NonstopStageMixer {
  const stageOfKey = new Map<string, number>();
  map.stages.forEach((stage, index) => stage.wavKeys.forEach((key) => stageOfKey.set(key, index)));
  const gains = map.stages.map((stage) => {
    const gain = audioContext.createGain();
    gain.gain.value = stage.soundFadeIn !== undefined ? 0 : 1;
    gain.connect(destination);
    return gain;
  });
  const tempo = options.tempo !== undefined && options.tempo > 0 ? options.tempo : 1;
  const fade = (gain: GainNode, window: NonstopFade, direction: 'in' | 'out', chartStart: number): void => {
    const start = Math.max(audioContext.currentTime, chartStart + chartToElapsedSeconds(window.start, tempo));
    const end = chartStart + chartToElapsedSeconds(window.end, tempo);
    if (end - start <= 1e-3) {
      gain.gain.setValueAtTime(direction === 'in' ? 1 : 0, Math.max(start, end));
      return;
    }
    gain.gain.setValueCurveAtTime(nonstopFadeCurve(direction), start, end - start);
  };
  return {
    stageOf: (sampleKey) => stageOfKey.get(sampleKey),
    // With keep pitch the samples were stretched to the stage's tempo already (`resolveSampleStretchRates`); the play
    // tempo is the audio session's own rate.
    rate: (stage) => (options.keepPitch === true ? 1 : (map.stages[stage]?.placement.rate ?? 1)),
    bgmInput: (stage) => gains[stage],
    schedule: (chartStart) => {
      map.stages.forEach((stage, index) => {
        const gain = gains[index]!;
        gain.gain.cancelScheduledValues(0);
        gain.gain.setValueAtTime(stage.soundFadeIn !== undefined ? 0 : 1, audioContext.currentTime);
        if (stage.soundFadeIn !== undefined) fade(gain, stage.soundFadeIn, 'in', chartStart);
        if (stage.soundFadeOut !== undefined) fade(gain, stage.soundFadeOut, 'out', chartStart);
      });
    },
    retime: (nowChartSeconds, contextTimeAt) => {
      const now = audioContext.currentTime;
      map.stages.forEach((stage, index) => {
        const gain = gains[index]!.gain;
        gain.cancelScheduledValues(0);
        const fades: Array<[NonstopFade, 'in' | 'out']> = [];
        if (stage.soundFadeIn !== undefined) fades.push([stage.soundFadeIn, 'in']);
        if (stage.soundFadeOut !== undefined) fades.push([stage.soundFadeOut, 'out']);
        const ahead = fades.filter(([window]) => window.end > nowChartSeconds);
        // A fade under way starts its curve now, from the value it has reached; otherwise hold that value until then.
        const underWay = ahead.some(([window]) => window.start <= nowChartSeconds && window.end - window.start > 1e-6);
        if (!underWay) gain.setValueAtTime(nonstopStageGainAt(stage, nowChartSeconds), now);
        for (const [window, direction] of ahead) {
          const from = Math.max(nowChartSeconds, window.start);
          const start = Math.max(now, contextTimeAt(from));
          const end = contextTimeAt(window.end);
          if (end - start <= 1e-3) {
            gain.setValueAtTime(direction === 'in' ? 1 : 0, Math.max(start, end));
            continue;
          }
          gain.setValueCurveAtTime(nonstopFadeCurve(direction, 64, fadeProgress(window, from)), start, end - start);
        }
      });
    },
    dispose: () => {
      for (const gain of gains) {
        try {
          gain.disconnect();
        } catch {
          // Already disconnected or the context is closed.
        }
      }
    },
  };
}
