/**
 * Audio routing for the gameplay scene.
 *
 * Three modes are supported:
 *
 * - **`'split'`** (default) — separate compressors on the key-sound
 *   and BGM buses, plus a master compressor that catches the summed
 *   peaks. Each bus is tuned for its content: key bus is
 *   transient-aggressive (jacks / dense input bursts), BGM bus is
 *   gentler / more musical, master is a final clip-protection
 *   limiter. This pattern matches the standard mastering bus layout
 *   and prevents the BGM from ducking under dense input bursts (the
 *   classic single-bus failure mode).
 *
 * - **`'legacy'`** — the original single-compressor bus, kept for
 *   A/B comparison via the demo's `?compressor=legacy` URL flag.
 *   Sample sources still connect to the same `keyMixer` /
 *   `bgmMixer` nodes so the gameplay code stays mode-agnostic; the
 *   builder just collapses both into a single compressor stage.
 *
 * - **`'off'`** — bypass every compressor. The two bus mixers wire
 *   directly to `audioContext.destination`. Used by the demo
 *   checkbox to compare against an unprocessed signal path.
 *
 * The graph topology stays stable across mode switches: the
 * `keyMixer` / `bgmMixer` `GainNode`s are always the connection
 * point for sample sources, so flipping the mode is a `disconnect()`
 * + reconnect of the downstream wiring rather than a full rebuild.
 * That matters because hundreds of one-shot `BufferSourceNode`s come
 * and go per second on dense charts; rebuilding their connection
 * point would be a real performance hazard.
 *
 * Compressor parameter values are exported as plain readonly objects
 * so they're easy to unit-test (no `AudioContext` required) and easy
 * to tweak in one place. See `audio-bus.test.ts` for sanity-range
 * coverage.
 */

export type CompressorMode = 'split' | 'legacy' | 'off';

/**
 * `DynamicsCompressorNode` parameter set (in spec units — same names
 * as the Web Audio properties). Exported so the demo / debug tooling
 * can introspect the active values without reading them off a live
 * `AudioContext`.
 */
export interface CompressorParams {
  /** Threshold in dB. Compression starts above this input level. */
  threshold: number;
  /**
   * Compression ratio (`x:1`). 1 = no compression, ∞ = limiter. We
   * stick to `1..20` per the Web Audio spec's clamp.
   */
  ratio: number;
  /** Attack time in seconds. Web Audio range: 0..1. */
  attack: number;
  /** Release time in seconds. Web Audio range: 0..1. */
  release: number;
  /**
   * Knee width in dB. Larger values = softer onset. Web Audio
   * range: 0..40.
   */
  knee: number;
}

/**
 * Key-sound bus compressor. Tuned to catch transient peak summing
 * during dense jacks and 16th-note input bursts without dulling
 * single-hit transients too much.
 *
 * Rationale per parameter:
 * - `threshold = -10`: lower than the master so the key bus engages
 *   first under load. Quiet single hits don't trigger anything.
 * - `ratio = 6`: aggressive enough to flatten jack bursts, not a
 *   limiter (ratio 10+) so each hit still carries through.
 * - `attack = 0.001`: as fast as Web Audio practically goes —
 *   percussive transients (drums / scratch) need to be caught at
 *   the leading edge.
 * - `release = 0.08`: 80 ms = roughly one 16th note at 180 BPM, so
 *   the compressor recovers between hits in dense bursts but stays
 *   engaged across same-position summing.
 * - `knee = 4`: slightly hard, biased toward "limiter-ish" feel.
 */
export const KEY_BUS_COMPRESSOR_PARAMS: Readonly<CompressorParams> = {
  threshold: -10,
  ratio: 6,
  attack: 0.001,
  release: 0.08,
  knee: 4,
};

/**
 * BGM bus compressor. Tuned to gently glue the auto-triggered
 * background bed without the per-hit pumping of the key bus
 * compressor.
 *
 * Rationale per parameter:
 * - `threshold = -12`: a touch lower than key bus because the BGM
 *   bed is generally hotter / steadier in level, so we want any
 *   compression to feel "always-on" rather than gated.
 * - `ratio = 3`: gentle, musical compression — keep the bed feeling
 *   natural.
 * - `attack = 0.005`: 5 ms lets BGM drum-loop kicks pass largely
 *   intact (1 ms would dull them).
 * - `release = 0.20`: 200 ms is long enough to avoid pumping on the
 *   beat grid.
 * - `knee = 10`: soft, so the compressor doesn't introduce a
 *   detectable threshold artefact.
 */
export const BGM_BUS_COMPRESSOR_PARAMS: Readonly<CompressorParams> = {
  threshold: -12,
  ratio: 3,
  attack: 0.005,
  release: 0.2,
  knee: 10,
};

/**
 * Master bus compressor. Final clip-protection limiter. With the
 * key / BGM compressors already shaping their respective buses,
 * the master only needs to catch the summed peaks, so it's tuned
 * as a hard limiter rather than a musical compressor.
 *
 * Rationale per parameter:
 * - `threshold = -3`: leaves 3 dB of explicit headroom below
 *   0 dBFS, so even worst-case summing won't clip the destination.
 * - `ratio = 10`: ≈ limiter behaviour. The bus inputs are already
 *   processed, so we can be aggressive here without "smashing".
 * - `attack = 0.001`, `release = 0.10`: fast capture, moderate
 *   release for transparent peak control.
 * - `knee = 2`: hard knee so the limiter activates decisively at
 *   the threshold (no slow onset).
 */
export const MASTER_BUS_COMPRESSOR_PARAMS: Readonly<CompressorParams> = {
  threshold: -3,
  ratio: 10,
  attack: 0.001,
  release: 0.1,
  knee: 2,
};

/**
 * Legacy (pre-split) single-compressor params. Preserved verbatim
 * from the original `prepareAudio` block so the `'legacy'` mode is
 * a true byte-for-byte revert that the demo can flip to via the
 * `?compressor=legacy` URL flag.
 */
export const LEGACY_COMPRESSOR_PARAMS: Readonly<CompressorParams> = {
  threshold: -8,
  ratio: 4,
  attack: 0.003,
  release: 0.12,
  knee: 6,
};

/**
 * Makeup gain (linear, not dB) applied after the master compressor
 * stage. ~+1 dB ≈ 1.12. Kept conservative because the per-bus
 * compressors are doing most of the level shaping; the master is a
 * limiter, not a loudness booster.
 */
export const MASTER_MAKEUP_GAIN_LINEAR = 1.12;

/**
 * Single bus-mode handle. The keys are stable references that
 * sample sources connect to (their own connections never need to
 * be touched after creation). `setMode(next)` re-routes the
 * downstream stages without disturbing the source-side wiring.
 *
 * `dispose()` tears down every node we created. The caller is
 * responsible for stopping any in-flight `BufferSourceNode` before
 * disposing — those connect to `keyMixer` / `bgmMixer` so they'd
 * otherwise survive into the next chart's bus and play through.
 */
export interface AudioBusHandle {
  readonly keyMixer: GainNode;
  readonly bgmMixer: GainNode;
  readonly mode: CompressorMode;
  setMode(next: CompressorMode): void;
  getMode(): CompressorMode;
  dispose(): void;
}

/**
 * Builds the audio bus and connects it to `audioContext.destination`.
 * Sample sources should connect to `keyMixer` (player input
 * keysounds) or `bgmMixer` (auto-triggered BGM) and never directly
 * to the destination — that bypasses every compressor stage and the
 * `setMode` toggle won't reach those samples.
 *
 * `initialMode` is the starting mode. Most callers pass `'split'`;
 * the demo's `?compressor=...` flag can pass `'legacy'` or `'off'`
 * for A/B comparison.
 */
export function buildAudioBus(audioContext: AudioContext, initialMode: CompressorMode = 'split'): AudioBusHandle {
  const keyMixer = audioContext.createGain();
  const bgmMixer = audioContext.createGain();
  // Per-bus compressors plus the master — created up front, wired
  // in/out by `applyMode`. Held even when the active mode doesn't
  // use them so the next `setMode` call can splice them back in
  // without re-creating Web Audio nodes (cheap, but recreating
  // would also reset their internal envelope state which wastes
  // any "warm" gain reduction the mode switch could otherwise
  // preserve).
  const keyComp = createCompressor(audioContext, KEY_BUS_COMPRESSOR_PARAMS);
  const bgmComp = createCompressor(audioContext, BGM_BUS_COMPRESSOR_PARAMS);
  const masterComp = createCompressor(audioContext, MASTER_BUS_COMPRESSOR_PARAMS);
  // Legacy mode reuses a single compressor with the original
  // pre-split params. Distinct node from the master so swapping
  // modes doesn't have to mutate AudioParam values mid-chart.
  const legacyComp = createCompressor(audioContext, LEGACY_COMPRESSOR_PARAMS);
  const makeup = audioContext.createGain();
  makeup.gain.value = MASTER_MAKEUP_GAIN_LINEAR;
  // The makeup → destination tail is shared by `'split'` and
  // `'legacy'`; only `'off'` skips it entirely.
  makeup.connect(audioContext.destination);

  let activeMode: CompressorMode = initialMode;
  applyMode(activeMode);

  function applyMode(mode: CompressorMode): void {
    // Tear down every routing edge we own. `disconnect()` with no
    // arg removes ALL outgoing edges; sample sources connect TO
    // keyMixer / bgmMixer (incoming edges) and aren't affected.
    keyMixer.disconnect();
    bgmMixer.disconnect();
    keyComp.disconnect();
    bgmComp.disconnect();
    masterComp.disconnect();
    legacyComp.disconnect();
    if (mode === 'off') {
      keyMixer.connect(audioContext.destination);
      bgmMixer.connect(audioContext.destination);
      return;
    }
    if (mode === 'legacy') {
      // keyMixer + bgmMixer → legacyComp → makeup → destination.
      keyMixer.connect(legacyComp);
      bgmMixer.connect(legacyComp);
      legacyComp.connect(makeup);
      return;
    }
    // 'split' — full 3-stage architecture.
    //
    //   keyMixer → keyComp ↘
    //                       masterComp → makeup → destination
    //   bgmMixer → bgmComp ↗
    keyMixer.connect(keyComp);
    bgmMixer.connect(bgmComp);
    keyComp.connect(masterComp);
    bgmComp.connect(masterComp);
    masterComp.connect(makeup);
  }

  return {
    keyMixer,
    bgmMixer,
    get mode(): CompressorMode {
      return activeMode;
    },
    setMode(next: CompressorMode): void {
      if (activeMode === next) return;
      activeMode = next;
      applyMode(next);
    },
    getMode(): CompressorMode {
      return activeMode;
    },
    dispose(): void {
      try {
        keyMixer.disconnect();
        bgmMixer.disconnect();
        keyComp.disconnect();
        bgmComp.disconnect();
        masterComp.disconnect();
        legacyComp.disconnect();
        makeup.disconnect();
      } catch {
        // `disconnect()` throws when called on an already-disposed
        // node. Swallowing is safe — `dispose()` is idempotent and
        // the only thing the caller cares about is "no future
        // outputs from this bus".
      }
    },
  };
}

function createCompressor(audioContext: AudioContext, params: CompressorParams): DynamicsCompressorNode {
  const node = audioContext.createDynamicsCompressor();
  node.threshold.value = params.threshold;
  node.ratio.value = params.ratio;
  node.attack.value = params.attack;
  node.release.value = params.release;
  node.knee.value = params.knee;
  return node;
}

/**
 * Parses a `?compressor=...` URL search-param value into a valid
 * {@link CompressorMode}, or `undefined` when the value is missing
 * / unrecognised so callers can fall through to their default. The
 * demo passes the URL's `searchParams.get('compressor')` here at
 * mount time.
 */
export function parseCompressorMode(raw: string | null | undefined): CompressorMode | undefined {
  if (raw === null || raw === undefined) return undefined;
  const lower = raw.trim().toLowerCase();
  if (lower === 'split' || lower === 'legacy' || lower === 'off') {
    return lower;
  }
  return undefined;
}
