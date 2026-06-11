import {
  isBmsBgmVolumeChangeChannel,
  isBmsKeyVolumeChangeChannel,
  isPlayLaneSoundChannel,
  parseBmsDynamicVolumeGain,
  usesMonophonicWavPlayback,
} from '@be-music/chart';
import {
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';
import type { AudioSession } from '@be-music/player/core/engine';
import { normalizePath } from '@be-music/utils/core';
import { type AudioBusHandle } from './audio-bus.ts';

interface WebAudioSourceHandle {
  node: AudioBufferSourceNode;
  buffer: AudioBuffer;
  gain: GainNode | undefined;
}

/**
 * Per-event playback override produced by the bmson 1.0.0 slicing pipeline. Each entry carries the seek `offset` into
 * the source `sound_channels[]` WAV plus an optional `duration` cap that bounds how long this slice plays before the
 * next note's slice takes over. BMS / json paths leave this map unset and play the whole WAV from `t = 0`.
 */
export interface WebAudioSessionSlicePlayback {
  offsetSeconds: number;
  durationSeconds?: number;
}

/**
 * Construction-time inputs for {@link createWebAudioSession}. Decoupled from `BeMusicJson` resolution so the demo's
 * existing prepare path can decode every `#WAVxx` to an `AudioBuffer` once and reuse the same buffer cache across
 * pause / restart / replay cycles without re-decoding.
 */
export interface WebAudioSessionContext {
  /** Live `AudioContext` shared with the rest of the player. The session never closes the context — that's the host's
   *  responsibility, since `AudioContext.close()` is irreversible and would brick the select / decide BGM paths. */
  audioContext: AudioContext;
  /** Pre-built audio bus from {@link createAudioBus} — sample sources land at `keyMixer` (player input) or `bgmMixer`
   *  (auto-triggered BGM) per the BMS channel routing rules below. */
  audioBus: AudioBusHandle;
  /** Resolved chart used to look up `event.value` → `#WAVxx` slot path and to read the `#BASE` radix for slot lookups
   *  on `#BASE 62` charts. */
  chart: BeMusicJson;
  /** Decoded WAV cache, keyed by lower-cased `normalizePath(resourceWavPath)`. The session reads from this map but
   *  never mutates it; the host keeps decoding ownership so cross-session caches stay possible. */
  decodedSamples: ReadonlyMap<string, AudioBuffer>;
  /** Per-`#WAVxx` slot gain multiplier produced by `collectBmsWavCmdVolumeMultipliers` /
   *  `collectBmsExWavVolumeMultipliers`. Slots without an entry play at unity gain. */
  wavCmdVolumeMultipliers: ReadonlyMap<string, number>;
  /** Optional per-event slice overrides for bmson sound-channel splitting — see
   *  {@link WebAudioSessionSlicePlayback}. */
  bmsonSlicePlayback?: ReadonlyMap<BeMusicEvent, WebAudioSessionSlicePlayback>;
  /** Lead-in (ms) the engine should wait between {@link AudioSession.start} and chart's note-zero timing. The web
   *  backend doesn't fill an output buffer before playback starts (Web Audio handles its own ring), so the default
   *  `0` is fine; exposed for parity with the engine's contract. */
  chartStartDelayMs?: number;
  /** Human-readable label surfaced on the engine's "Audio backend: ..." log line. Defaults to `'web-audio'`. */
  backendLabel?: string;
  /**
   * Closure that returns the chart's t=0 on the audio-context clock — i.e. the value the host's renderer treats
   * as `audioContextStartTime`. Used by {@link AudioSession.getClockState} to keep the engine's playback clock in
   * lock-step with the renderer's `currentSeconds()` calculation, so judges fire exactly when the note hits the
   * judgment line. Returning `0` (the default when omitted) makes the session report the absolute audio-context
   * time, which matches the legacy "engine owns its own playback clock" flow but causes a per-chart drift between
   * renderer and judge if the host's renderer references a different anchor.
   */
  getChartStartContextTime?: () => number;
}

/**
 * Extension of the engine's {@link AudioSession} contract that exposes the web-only "schedule a sample at a precise
 * audio-context time" affordance. Web Audio's `BufferSource.start(when)` lets us pre-schedule BGM cues sample-
 * accurately up to ~0.5s ahead, which is dramatically tighter than the per-frame `triggerEvent` cadence the engine
 * uses on the TUI side. Hosts that drive their own per-frame BGM look-ahead (the existing `scene/lr2/gameplay`
 * `scheduleAutoSamples` path) call {@link scheduleEvent} instead of `triggerEvent` so the buffer is queued at the
 * right audio-context timestamp rather than firing immediately.
 */
export interface WebAudioSession extends AudioSession {
  /**
   * Schedules `event`'s associated `#WAVxx` slot to start at `audioContextStartSeconds` (the absolute time on the
   * `AudioContext.currentTime` clock — usually computed by the host as `chartStartContextTime + chartSeconds`).
   *
   * Routing rules and `#WAVCMD` gain handling are identical to {@link AudioSession.triggerEvent}; only the start
   * timing differs. When `audioContextStartSeconds` is in the past the buffer fires immediately (Web Audio's
   * `start(when)` semantics), so a host that polls on a slightly-late tick won't drop the cue.
   */
  scheduleEvent: (event: BeMusicEvent, audioContextStartSeconds: number) => void;
}

/**
 * Web Audio API implementation of the engine's {@link AudioSession} contract. Sole purpose is to plug a browser
 * runtime into the same judge / fallback / LN logic the TUI uses, so the web (Pixi) view doesn't need to keep its
 * own copy of the BMS sample triggering rules.
 *
 * Routing rules (mirror what the engine's TUI session does on Node):
 *
 * - **Player input lanes (`#xxx11..#xxx29` minus volume channels)** — route through `audioBus.keyMixer` so the
 *   key-bus compressor sees the input transient stream.
 * - **Auto-triggered lane sounds (`#xxx01`, `#xxx51..#xxx69` LN-start, `#xxx07` POOR BGA, etc.)** — route through
 *   `audioBus.bgmMixer` so the BGM bed shares the BGM compressor.
 * - **`#xxx97` / `#xxx98` dynamic volume events** — update the session's current BGM / key dynamic gain. Per
 *   docs/bms-spec.md「#xxx97 / #xxx98」, the new level applies as the initial gain of voices triggered from that
 *   point on; already-playing voices keep the gain they started with (mirrors the engine's Node mixer behavior).
 * - **`#xxxD0` / `#xxxE0` (landmine explosions)** — route through `bgmMixer` (the engine fires these via
 *   `triggerEvent` on landmine hit; the explosion is BGM-style, not the player's keysound).
 *
 * **bmson `note.c = true` continuation** — when a previous instance of the same `#WAV` slot is still playing and the
 * incoming event carries `c = true`, the new trigger is suppressed so the sustained sample plays through. Tracked
 * via {@link tracking} — the active `BufferSourceNode` per slot is dropped on `onended`.
 *
 * **Channel-targeted stop** (`stopChannel`) — when the engine retires an LN early (LNMODE 1 grace expired, LNMODE 2/3
 * mid-hold release), it expects the session to silence the keysound on that lane. The session keeps a per-channel map
 * of the most recent `BufferSourceNode` triggered for that channel and calls `node.stop()` when asked.
 */
export function createWebAudioSession(context: WebAudioSessionContext): WebAudioSession {
  const { audioContext, audioBus, chart, decodedSamples, wavCmdVolumeMultipliers, bmsonSlicePlayback } = context;
  const resolveChartStartContextTime = context.getChartStartContextTime ?? (() => 0);
  const sampleIdBase = resolveBmsBase(chart);
  /** Active BufferSource per `#WAVxx` slot. Used to honor bmson `c = true` (skip retrigger of a still-playing sample)
   *  and to wipe the slot once the source ends naturally. */
  const activeBySlot = new Map<string, WebAudioSourceHandle>();
  /** Active BufferSource per BMS channel (lane). Populated for player-input lanes so `stopChannel` can silence the
   *  most recent keysound when the engine releases an LN early. */
  const activeByChannel = new Map<string, WebAudioSourceHandle>();
  const activeSources = new Set<WebAudioSourceHandle>();
  let paused = false;
  let disposed = false;
  let started = false;
  // `#xxx97` / `#xxx98` current dynamic gains. Spec (docs/bms-spec.md「#xxx97 / #xxx98」): a volume change applies to
  // voices triggered from that point on; already-playing voices are untouched. The gain is therefore captured
  // per-voice at build time instead of being written onto the shared bus mixers.
  let currentBgmDynamicGain = 1;
  let currentKeyDynamicGain = 1;

  const resolveSamplePath = (event: BeMusicEvent): { sampleKey: string; path: string } | undefined => {
    const sampleKey = normalizeObjectKey(event.value, sampleIdBase);
    const path = chart.resources.wav[sampleKey];
    if (typeof path !== 'string') return undefined;
    return { sampleKey, path };
  };

  /**
   * Builds + parents a `BufferSourceNode` to the appropriate mixer with the `#WAVCMD` per-slot gain and the current
   * `#xxx97` / `#xxx98` dynamic gain spliced in. Returns `undefined` when the slot has no decoded buffer (chart
   * referenced an asset we never loaded, e.g. a missing file).
   */
  const buildSourceNode = (
    sampleKey: string,
    path: string,
    bus: GainNode,
    dynamicGain: number,
  ): WebAudioSourceHandle | undefined => {
    const buffer = decodedSamples.get(normalizePath(path).toLowerCase());
    if (!buffer) return undefined;
    const node = audioContext.createBufferSource();
    node.buffer = buffer;
    let gain: GainNode | undefined;
    const combinedGain = (wavCmdVolumeMultipliers.get(sampleKey) ?? 1) * dynamicGain;
    if (combinedGain !== 1) {
      gain = audioContext.createGain();
      gain.gain.value = combinedGain;
      node.connect(gain);
      gain.connect(bus);
    } else {
      node.connect(bus);
    }
    return { node, buffer, gain };
  };

  const disconnectSource = (handle: WebAudioSourceHandle): void => {
    try {
      handle.node.disconnect();
    } catch {
      // Already disconnected / context closed — both terminal states.
    }
    if (handle.gain !== undefined) {
      try {
        handle.gain.disconnect();
      } catch {
        // Same as above; source cleanup is best-effort.
      }
    }
  };

  const forgetSource = (handle: WebAudioSourceHandle): void => {
    activeSources.delete(handle);
    for (const [slot, active] of activeBySlot) {
      if (active === handle) activeBySlot.delete(slot);
    }
    for (const [channel, active] of activeByChannel) {
      if (active === handle) activeByChannel.delete(channel);
    }
  };

  const stopSource = (handle: WebAudioSourceHandle, stopAt?: number): void => {
    const scheduledStopAt =
      typeof stopAt === 'number' && Number.isFinite(stopAt) ? Math.max(audioContext.currentTime, stopAt) : undefined;
    try {
      if (scheduledStopAt !== undefined) {
        handle.node.stop(scheduledStopAt);
      } else {
        handle.node.stop();
      }
    } catch {
      // Already stopped, never started, or context closed.
    }

    if (scheduledStopAt === undefined || scheduledStopAt <= audioContext.currentTime + 1e-6) {
      forgetSource(handle);
      disconnectSource(handle);
    }
  };

  const playSampleEvent = (event: BeMusicEvent, audioContextStartSeconds?: number): void => {
    if (disposed) return;
    const resolved = resolveSamplePath(event);
    if (!resolved) return;
    const { sampleKey, path } = resolved;

    // bmson `c = true` — a previous instance of this slot is still playing, so the chart asked for a sustained
    // continuation rather than a fresh attack. Skip the retrigger and let the existing source ride through.
    if (event.bmson?.c === true && activeBySlot.has(sampleKey)) return;

    const channel = normalizeChannel(event.channel);
    const isPlayerLane = isPlayLaneSoundChannel(channel);
    const bus = isPlayerLane ? audioBus.keyMixer : audioBus.bgmMixer;
    const built = buildSourceNode(sampleKey, path, bus, isPlayerLane ? currentKeyDynamicGain : currentBgmDynamicGain);
    if (!built) return;
    const { node, buffer } = built;

    node.onended = (): void => {
      forgetSource(built);
      disconnectSource(built);
    };

    const slice = bmsonSlicePlayback?.get(event);
    const offsetSeconds = clampSampleOffset(slice?.offsetSeconds, buffer.duration);
    const durationSeconds = clampSampleDuration(slice?.durationSeconds, buffer.duration, offsetSeconds);
    // Scheduled BGM cues clamp to "now" so a slightly-late polling tick still fires immediately rather than
    // throwing for a past timestamp; player-input keysounds and immediate triggers go through the no-`when` path.
    const startAt =
      audioContextStartSeconds !== undefined ? Math.max(audioContext.currentTime, audioContextStartSeconds) : undefined;
    if (usesMonophonicWavPlayback(chart)) {
      const previous = activeBySlot.get(sampleKey);
      if (previous) {
        stopSource(previous, startAt);
      }
    }
    startSampleNode(node, startAt, offsetSeconds, durationSeconds);

    activeSources.add(built);
    activeBySlot.set(sampleKey, built);
    if (isPlayerLane) activeByChannel.set(channel, built);
  };

  const applyDynamicVolumeEvent = (event: BeMusicEvent): void => {
    if (disposed) return;
    const gain = parseBmsDynamicVolumeGain(event.value);
    if (gain === undefined) return;
    const clamped = Math.max(0, Math.min(1, gain));
    // Bgm channel = `97`, key channel = `98`. The dispatcher already gated on
    // `isBmsDynamicVolumeChangeChannel(event.channel)` so one of the two predicates must match — but we still branch
    // explicitly so an unrecognized future channel doesn't accidentally retarget the wrong side. The stored gain is
    // consumed by `buildSourceNode` for subsequently triggered voices only — never written to the live bus mixers,
    // so in-flight voices keep the level they started with (docs/bms-spec.md「#xxx97 / #xxx98」).
    if (isBmsBgmVolumeChangeChannel(event.channel)) {
      currentBgmDynamicGain = clamped;
    } else if (isBmsKeyVolumeChangeChannel(event.channel)) {
      currentKeyDynamicGain = clamped;
    }
  };

  return {
    backendLabel: context.backendLabel ?? 'web-audio',
    chartStartDelayMs: context.chartStartDelayMs ?? 0,
    start: (): void => {
      // Defensive — repeat starts are a no-op so a host that re-invokes `start()` after pause / resume doesn't reset
      // the active-source tracking (which would lose `stopChannel` reach to in-flight LN samples).
      if (started) return;
      started = true;
    },
    pause: (): void => {
      if (paused) return;
      paused = true;
      void audioContext.suspend?.().catch(() => undefined);
    },
    resume: (): void => {
      if (!paused) return;
      paused = false;
      void audioContext.resume?.().catch(() => undefined);
    },
    /**
     * Reports the chart's elapsed audio-context time so the engine's playback clock locks to the same reference
     * the renderer's `currentSeconds()` is using. Without this, the engine's default
     * `createPerformancePlaybackClockSource` would tick on `performance.now()` minus its own internal start
     * stamp — which drifts from the audio-context clock by however long the engine took to set up between the
     * host setting its `audioContextStartTime` and the engine entering its tick loop. The drift is small (tens
     * of ms) but enough to push judges off the visual judgment line by a couple of frames.
     */
    getClockState: () => {
      const chartStart = resolveChartStartContextTime();
      const outputSeconds = Math.max(0, audioContext.currentTime - chartStart);
      // We don't actually buffer ahead on the web (Web Audio's BufferSource handles its own scheduling), so the
      // scheduled head matches the output head. Reporting the same value lets the engine's
      // `createAudioPlaybackClockSource` short-circuit its `Math.max` between the two.
      return { outputSeconds, scheduledSeconds: outputSeconds };
    },
    finish: async (): Promise<void> => {
      // Engine finished playback gracefully — let any tail samples ring out naturally. Drop our tracking so a
      // post-finish `stopChannel` (defensive) doesn't try to silence an already-cleaned source.
      activeBySlot.clear();
      activeByChannel.clear();
      activeSources.clear();
    },
    dispose: async (): Promise<void> => {
      if (disposed) return;
      disposed = true;
      // Hard-stop every still-playing source so they don't survive into the next chart's bus and bleed audio. The
      // engine's dispose path runs after `finish` (the abort variant) — the source set is empty in the graceful
      // path so this loop is a no-op there.
      for (const handle of [...activeSources]) {
        stopSource(handle);
      }
      activeBySlot.clear();
      activeByChannel.clear();
      activeSources.clear();
    },
    triggerEvent: (event: BeMusicEvent): void => {
      // Dynamic volume changes (`#xxx97` / `#xxx98`) reach the session through the same `triggerEvent` channel as
      // sample plays — the engine batches all realtime audio into one stream — so we branch on the channel here.
      if (isBmsBgmVolumeChangeChannel(event.channel) || isBmsKeyVolumeChangeChannel(event.channel)) {
        applyDynamicVolumeEvent(event);
        return;
      }
      playSampleEvent(event);
    },
    scheduleEvent: (event: BeMusicEvent, audioContextStartSeconds: number): void => {
      // Scheduled cues are exclusively BGM-style triggers (player input is by definition immediate), so we don't
      // expect dynamic volume events to arrive here — but route them through the same handler if they ever do so a
      // misuse doesn't silently drop the event.
      if (isBmsBgmVolumeChangeChannel(event.channel) || isBmsKeyVolumeChangeChannel(event.channel)) {
        applyDynamicVolumeEvent(event);
        return;
      }
      playSampleEvent(event, audioContextStartSeconds);
    },
    stopChannel: (channel: string): void => {
      const handle = activeByChannel.get(normalizeChannel(channel));
      if (!handle) return;
      stopSource(handle);
    },
  };
}

/**
 * Clamps a bmson slice offset against the loaded buffer's duration so a misauthored offset (or one that came from a
 * trimmed take) doesn't produce a `start()` call past EOF — Web Audio would silently emit nothing in that case. Any
 * non-finite / negative input collapses to 0 so the historical "play from t=0" behavior stays the default fallback.
 *
 * Exported for test parity with the inlined version that {@link createWebAudioSession} uses internally.
 */
export function clampSampleOffset(offsetSeconds: number | undefined, bufferDuration: number): number {
  if (typeof offsetSeconds !== 'number' || !Number.isFinite(offsetSeconds) || offsetSeconds <= 0) {
    return 0;
  }
  if (offsetSeconds >= bufferDuration) {
    return Math.max(0, bufferDuration - 1e-3);
  }
  return offsetSeconds;
}

/**
 * Caps a bmson slice duration against the loaded buffer's tail so the slice playback doesn't overshoot the file.
 * Returns `undefined` when no duration was authored — the caller then lets the buffer source play to its natural end
 * (matching BMS-style "trigger plays the whole sample" semantics).
 */
export function clampSampleDuration(
  durationSeconds: number | undefined,
  bufferDuration: number,
  offsetSeconds: number,
): number | undefined {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return undefined;
  }
  const remaining = Math.max(0, bufferDuration - offsetSeconds);
  if (remaining <= 0) {
    return undefined;
  }
  return Math.min(durationSeconds, remaining);
}

/**
 * Wraps `AudioBufferSourceNode.start` so the offset / duration arguments only get supplied when meaningful — Web Audio
 * differentiates `start(when)` (whole buffer) from `start(when, offset)` (seek) from `start(when, offset, duration)`
 * (seek + cap), and we want to match the historical behavior for the two- and three-arg cases when slicing isn't in
 * play.
 *
 * `when` of `undefined` calls `start()` (immediate); a finite value calls `start(when)` (scheduled).
 */
export function startSampleNode(
  node: AudioBufferSourceNode,
  when: number | undefined,
  offsetSeconds: number,
  durationSeconds: number | undefined,
): void {
  const hasOffset = offsetSeconds > 0;
  const hasDuration = typeof durationSeconds === 'number';
  if (when !== undefined) {
    if (hasDuration) {
      node.start(when, offsetSeconds, durationSeconds);
    } else if (hasOffset) {
      node.start(when, offsetSeconds);
    } else {
      node.start(when);
    }
    return;
  }
  if (hasDuration) {
    node.start(0, offsetSeconds, durationSeconds);
  } else if (hasOffset) {
    node.start(0, offsetSeconds);
  } else {
    node.start();
  }
}
