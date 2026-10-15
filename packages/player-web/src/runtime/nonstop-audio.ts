import type { NonstopFade, NonstopStitchMap } from '@be-music/player/course';

/**
 * How a {@link createWebAudioSession} session plays a stitched NONSTOP chart's samples: which stage a stitched WAV key
 * belongs to, the playback rate of that stage's samples (FIT changes their pitch), and where a stage's background sound
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
  dispose(): void;
}

/**
 * The gain curve of an LR2 stage fade: LR2 ramps the volume linearly and applies its square (OpenLR2 `LR2f.cpp`
 * L12579-L12605, L29040), so a fade-in rises as `t²` and a fade-out falls as `(1 − t)²`.
 */
export function nonstopFadeCurve(direction: 'in' | 'out', samples = 64): Float32Array {
  const curve = new Float32Array(Math.max(2, samples));
  for (let index = 0; index < curve.length; index += 1) {
    const t = index / (curve.length - 1);
    const volume = direction === 'in' ? t : 1 - t;
    curve[index] = volume * volume;
  }
  return curve;
}

/**
 * One gain per stage of a stitched NONSTOP chart, between the stage's background voices and `destination` (the BGM
 * bus). A stage with a fade-in starts silent, as LR2 starts that stage's BGM channel at 0; keysounds of the player's
 * lanes are not faded.
 */
export function createNonstopStageMixer(
  audioContext: BaseAudioContext,
  destination: AudioNode,
  map: NonstopStitchMap,
): NonstopStageMixer {
  const stageOfKey = new Map<string, number>();
  map.stages.forEach((stage, index) => stage.wavKeys.forEach((key) => stageOfKey.set(key, index)));
  const gains = map.stages.map((stage) => {
    const gain = audioContext.createGain();
    gain.gain.value = stage.soundFadeIn !== undefined ? 0 : 1;
    gain.connect(destination);
    return gain;
  });
  const fade = (gain: GainNode, window: NonstopFade, direction: 'in' | 'out', chartStart: number): void => {
    const start = Math.max(audioContext.currentTime, chartStart + window.start);
    const end = chartStart + window.end;
    if (end - start <= 1e-3) {
      gain.gain.setValueAtTime(direction === 'in' ? 1 : 0, Math.max(start, end));
      return;
    }
    gain.gain.setValueCurveAtTime(nonstopFadeCurve(direction), start, end - start);
  };
  return {
    stageOf: (sampleKey) => stageOfKey.get(sampleKey),
    rate: (stage) => map.stages[stage]?.placement.rate ?? 1,
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
