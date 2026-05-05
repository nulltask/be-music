import {
  isBmsBgmVolumeChangeChannel,
  isBmsKeyVolumeChangeChannel,
  isPlayLaneSoundChannel,
  parseBmsDynamicVolumeGain,
} from '@be-music/chart';
import { normalizeObjectKey, resolveBmsBase, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
import type { AudioSession } from '@be-music/player/core/engine';
import { normalizePath } from '@be-music/utils/core';
import { type AudioBusHandle } from './audio-bus.ts';
import { logger } from './logger.ts';

const log = logger('web-audio-session');

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
 * - **`#xxx97` / `#xxx98` dynamic volume events** — interpret as a chart-level absolute gain change against the
 *   matching mixer (`97 = bgmMixer`, `98 = keyMixer`) using `setValueAtTime` at audio-context "now".
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
export function createWebAudioSession(context: WebAudioSessionContext): AudioSession {
  const { audioContext, audioBus, chart, decodedSamples, wavCmdVolumeMultipliers, bmsonSlicePlayback } = context;
  const sampleIdBase = resolveBmsBase(chart);
  /** Active BufferSource per `#WAVxx` slot. Used to honor bmson `c = true` (skip retrigger of a still-playing sample)
   *  and to wipe the slot once the source ends naturally. */
  const activeBySlot = new Map<string, AudioBufferSourceNode>();
  /** Active BufferSource per BMS channel (lane). Populated for player-input lanes so `stopChannel` can silence the
   *  most recent keysound when the engine releases an LN early. */
  const activeByChannel = new Map<string, AudioBufferSourceNode>();
  let paused = false;
  let disposed = false;
  let started = false;

  const resolveSamplePath = (event: BeMusicEvent): { sampleKey: string; path: string } | undefined => {
    const sampleKey = normalizeObjectKey(event.value, sampleIdBase);
    const path = chart.resources.wav[sampleKey];
    if (typeof path !== 'string') return undefined;
    return { sampleKey, path };
  };

  /**
   * Builds + parents a `BufferSourceNode` to the appropriate mixer with `#WAVCMD` per-slot gain spliced in. Returns
   * `undefined` when the slot has no decoded buffer (chart referenced an asset we never loaded, e.g. a missing file).
   */
  const buildSourceNode = (
    sampleKey: string,
    path: string,
    bus: GainNode,
  ): { node: AudioBufferSourceNode; buffer: AudioBuffer } | undefined => {
    const buffer = decodedSamples.get(normalizePath(path).toLowerCase());
    if (!buffer) return undefined;
    const node = audioContext.createBufferSource();
    node.buffer = buffer;
    const multiplier = wavCmdVolumeMultipliers.get(sampleKey);
    if (multiplier !== undefined && multiplier !== 1) {
      const gain = audioContext.createGain();
      gain.gain.value = multiplier;
      node.connect(gain);
      gain.connect(bus);
    } else {
      node.connect(bus);
    }
    return { node, buffer };
  };

  const playSampleEvent = (event: BeMusicEvent): void => {
    if (disposed) return;
    const resolved = resolveSamplePath(event);
    if (!resolved) return;
    const { sampleKey, path } = resolved;

    // bmson `c = true` — a previous instance of this slot is still playing, so the chart asked for a sustained
    // continuation rather than a fresh attack. Skip the retrigger and let the existing source ride through.
    if (event.bmson?.c === true && activeBySlot.has(sampleKey)) return;

    const channel = event.channel;
    const isPlayerLane = isPlayLaneSoundChannel(channel);
    const bus = isPlayerLane ? audioBus.keyMixer : audioBus.bgmMixer;
    const built = buildSourceNode(sampleKey, path, bus);
    if (!built) return;
    const { node, buffer } = built;

    node.onended = (): void => {
      try {
        node.disconnect();
      } catch {
        // Already disconnected / context closed — both terminal states.
      }
      if (activeBySlot.get(sampleKey) === node) activeBySlot.delete(sampleKey);
      if (isPlayerLane && activeByChannel.get(channel) === node) activeByChannel.delete(channel);
    };

    const slice = bmsonSlicePlayback?.get(event);
    const offsetSeconds = clampSampleOffset(slice?.offsetSeconds, buffer.duration);
    const durationSeconds = clampSampleDuration(slice?.durationSeconds, buffer.duration, offsetSeconds);
    startSampleNode(node, undefined, offsetSeconds, durationSeconds);

    activeBySlot.set(sampleKey, node);
    if (isPlayerLane) activeByChannel.set(channel, node);
  };

  const applyDynamicVolumeEvent = (event: BeMusicEvent): void => {
    if (disposed) return;
    const gain = parseBmsDynamicVolumeGain(event.value);
    if (gain === undefined) return;
    // Bgm channel = `97`, key channel = `98`. The dispatcher already gated on
    // `isBmsDynamicVolumeChangeChannel(event.channel)` so one of the two predicates must match — but we still pick
    // the mixer explicitly so an unrecognized future channel doesn't accidentally retarget the wrong bus.
    const target = isBmsBgmVolumeChangeChannel(event.channel)
      ? audioBus.bgmMixer
      : isBmsKeyVolumeChangeChannel(event.channel)
        ? audioBus.keyMixer
        : undefined;
    if (!target) return;
    const clamped = Math.max(0, Math.min(1, gain));
    try {
      target.gain.setValueAtTime(clamped, audioContext.currentTime);
    } catch (error) {
      // Sealed AudioParam (extremely rare — bus disposed mid-flight). Drop the event silently; the next prepare
      // re-establishes the mixer.
      log.warn('failed to apply dynamic volume event', error);
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
    finish: async (): Promise<void> => {
      // Engine finished playback gracefully — let any tail samples ring out naturally. Drop our tracking so a
      // post-finish `stopChannel` (defensive) doesn't try to silence an already-cleaned source.
      activeBySlot.clear();
      activeByChannel.clear();
    },
    dispose: async (): Promise<void> => {
      if (disposed) return;
      disposed = true;
      // Hard-stop every still-playing source so they don't survive into the next chart's bus and bleed audio. The
      // engine's dispose path runs after `finish` (the abort variant) — the source set is empty in the graceful
      // path so this loop is a no-op there.
      for (const node of activeBySlot.values()) {
        try {
          node.stop();
        } catch {
          // Already stopped — `BufferSourceNode.stop` throws when called after `onended` fired.
        }
      }
      activeBySlot.clear();
      activeByChannel.clear();
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
    stopChannel: (channel: string): void => {
      const node = activeByChannel.get(channel);
      if (!node) return;
      activeByChannel.delete(channel);
      try {
        node.stop();
      } catch {
        // Already stopped — see dispose() rationale.
      }
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
