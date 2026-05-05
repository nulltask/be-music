/**
 * Audio routing for the gameplay scene.
 *
 * Three modes are supported:
 *
 * - **`'split'`** (default) — separate compressors on the key-sound and BGM buses, plus a master compressor that
 *   catches the summed peaks. Each bus is tuned for its content: key bus is transient-aggressive (jacks / dense input
 *   bursts), BGM bus is gentler / more musical, master is a final clip-protection limiter. This pattern matches the
 *   standard mastering bus layout and prevents the BGM from ducking under dense input bursts (the classic single-bus
 *   failure mode).
 *
 * - **`'legacy'`** — the original single-compressor bus, kept for A/B comparison via the demo's `?compressor=legacy`
 *   URL flag. Sample sources still connect to the same `keyMixer` / `bgmMixer` nodes so the gameplay code stays
 *   mode-agnostic; the builder just collapses both into a single compressor stage.
 *
 * - **`'off'`** — bypass every compressor. The two bus mixers wire directly to `audioContext.destination`. Used by the
 *   demo checkbox to compare against an unprocessed signal path.
 *
 * The graph topology stays stable across mode switches: the `keyMixer` / `bgmMixer` `GainNode`s are always the
 * connection point for sample sources, so flipping the mode is a `disconnect()` + reconnect of the downstream wiring
 * rather than a full rebuild. That matters because hundreds of one-shot `BufferSourceNode`s come and go per second on
 * dense charts; rebuilding their connection point would be a real performance hazard.
 *
 * Compressor parameter values are exported as plain readonly objects so they're easy to unit-test (no `AudioContext`
 * required) and easy to tweak in one place. See `audio-bus.test.ts` for sanity-range coverage.
 */

export type CompressorMode = 'split' | 'legacy' | 'off';

/**
 * `DynamicsCompressorNode` parameter set (in spec units — same names as the Web Audio properties). Exported so the demo
 * / debug tooling can introspect the active values without reading them off a live `AudioContext`.
 */
export interface CompressorParams {
  /** Threshold in dB. Compression starts above this input level. */
  threshold: number;
  /**
   * Compression ratio (`x:1`). 1 = no compression, ∞ = limiter. We stick to `1..20` per the Web Audio spec's clamp.
   */
  ratio: number;
  /** Attack time in seconds. Web Audio range: 0..1. */
  attack: number;
  /** Release time in seconds. Web Audio range: 0..1. */
  release: number;
  /**
   * Knee width in dB. Larger values = softer onset. Web Audio range: 0..40.
   */
  knee: number;
}

/**
 * Key-sound bus compressor. Tuned to catch transient peak summing during dense jacks and 16th-note input bursts without
 * dulling single-hit transients too much.
 *
 * Rationale per parameter: - `threshold = -10`: lower than the master so the key bus engages first under load. Quiet
 * single hits don't trigger anything. - `ratio = 6`: aggressive enough to flatten jack bursts, not a limiter (ratio
 * 10+) so each hit still carries through. - `attack = 0.001`: as fast as Web Audio practically goes — percussive
 * transients (drums / scratch) need to be caught at the leading edge. - `release = 0.08`: 80 ms = roughly one 16th note
 * at 180 BPM, so the compressor recovers between hits in dense bursts but stays engaged across same-position summing. -
 * `knee = 4`: slightly hard, biased toward "limiter-ish" feel.
 */
export const KEY_BUS_COMPRESSOR_PARAMS: Readonly<CompressorParams> = {
  threshold: -10,
  ratio: 6,
  attack: 0.001,
  release: 0.08,
  knee: 4,
};

/**
 * BGM bus compressor. Tuned to gently glue the auto-triggered background bed without the per-hit pumping of the key bus
 * compressor.
 *
 * Rationale per parameter: - `threshold = -12`: a touch lower than key bus because the BGM bed is generally hotter /
 * steadier in level, so we want any compression to feel "always-on" rather than gated. - `ratio = 3`: gentle, musical
 * compression — keep the bed feeling natural. - `attack = 0.005`: 5 ms lets BGM drum-loop kicks pass largely intact (1
 * ms would dull them). - `release = 0.20`: 200 ms is long enough to avoid pumping on the beat grid. - `knee = 10`:
 * soft, so the compressor doesn't introduce a detectable threshold artefact.
 */
export const BGM_BUS_COMPRESSOR_PARAMS: Readonly<CompressorParams> = {
  threshold: -12,
  ratio: 3,
  attack: 0.005,
  release: 0.2,
  knee: 10,
};

/**
 * Master bus compressor. Final clip-protection limiter. With the key / BGM compressors already shaping their respective
 * buses, the master only needs to catch the summed peaks, so it's tuned as a hard limiter rather than a musical
 * compressor.
 *
 * Rationale per parameter: - `threshold = -3`: leaves 3 dB of explicit headroom below 0 dBFS, so even worst-case
 * summing won't clip the destination. - `ratio = 10`: ≈ limiter behaviour. The bus inputs are already processed, so we
 * can be aggressive here without "smashing". - `attack = 0.001`, `release = 0.10`: fast capture, moderate release for
 * transparent peak control. - `knee = 2`: hard knee so the limiter activates decisively at the threshold (no slow
 * onset).
 */
export const MASTER_BUS_COMPRESSOR_PARAMS: Readonly<CompressorParams> = {
  threshold: -3,
  ratio: 10,
  attack: 0.001,
  release: 0.1,
  knee: 2,
};

/**
 * Legacy (pre-split) single-compressor params. Preserved verbatim from the original `prepareAudio` block so the
 * `'legacy'` mode is a true byte-for-byte revert that the demo can flip to via the `?compressor=legacy` URL flag.
 */
export const LEGACY_COMPRESSOR_PARAMS: Readonly<CompressorParams> = {
  threshold: -8,
  ratio: 4,
  attack: 0.003,
  release: 0.12,
  knee: 6,
};

/**
 * Makeup gain (linear, not dB) applied after the master compressor stage. ~+1 dB ≈ 1.12. Kept conservative because the
 * per-bus compressors are doing most of the level shaping; the master is a limiter, not a loudness booster.
 */
export const MASTER_MAKEUP_GAIN_LINEAR = 1.12;

/**
 * Per-mixer summing-headroom gain (linear). Each `BufferSourceNode` connects to `keyMixer` / `bgmMixer` at unity, so N
 * simultaneous samples sum to amplitude N at the mixer output. With BMS charts routinely overlapping 4–6 samples (chord
 * notes + scratch + BGM layers), the un-attenuated sum digital-clips at the destination (16-bit DAC clamp). Setting the
 * mixer gain below unity buys `1/MIXER_HEADROOM_GAIN_LINEAR` clean voices before the compressor stack has to do
 * anything; remaining peaks are caught by the master limiter.
 *
 * `0.5` ≈ −6 dB → ~2 simultaneous unity-amplitude samples sum to full scale. Combined with the split-bus master limiter
 * (threshold = −3 dB, ratio 10) the perceived headroom is generous enough that sustained clipping is essentially
 * impossible on typical BMS charts. Single-source playback is ~5 dB quieter than with unity mixers — the user can
 * compensate with system volume, which is preferable to having the player surreptitiously clip.
 */
export const MIXER_HEADROOM_GAIN_LINEAR = 0.5;

/**
 * Per-compressor-stage identifier used by {@link AudioBusHandle.setStageEnabled}.
 *
 * - `'key'` — key bus compressor (between `keyMixer` and master).
 * - `'bgm'` — BGM bus compressor (between `bgmMixer` and master).
 * - `'master'` — final master bus compressor.
 *
 * Stage toggles only have an effect in `'split'` mode. `'legacy'` has just a single compressor (toggling individual
 * stages there is meaningless — use mode `'off'` to bypass it) and `'off'` is already a complete bypass.
 */
export type CompressorStage = 'key' | 'bgm' | 'master';

/** Per-stage on/off state. Defaults to all `true` (every stage engaged). */
export interface CompressorStages {
  key: boolean;
  bgm: boolean;
  master: boolean;
}

/**
 * Single bus-mode handle. The keys are stable references that sample sources connect to (their own connections never
 * need to be touched after creation). `setMode(next)` re-routes the downstream stages without disturbing the
 * source-side wiring.
 *
 * `dispose()` tears down every node we created. The caller is responsible for stopping any in-flight `BufferSourceNode`
 * before disposing — those connect to `keyMixer` / `bgmMixer` so they'd otherwise survive into the next chart's bus and
 * play through.
 */
export interface AudioBusHandle {
  readonly keyMixer: GainNode;
  readonly bgmMixer: GainNode;
  /**
   * Final node before `audioContext.destination` — i.e. the stage the playback actually reaches the speakers from.
   * Exposed so external taps (recording, analysers, level meters) can `connect` to their own destinations without
   * disrupting the main path.
   *
   * Internally a unity-gain `GainNode` that every mode (`'off'` / `'legacy'` / `'split'`) routes through. Unity gain
   * means the tap is acoustically transparent — even `'off'` mode's "raw signal" goes through it without level / phase
   * change. Recording therefore captures whatever the user is hearing regardless of the active compressor
   * configuration.
   */
  readonly outputNode: AudioNode;
  readonly mode: CompressorMode;
  setMode(next: CompressorMode): void;
  getMode(): CompressorMode;
  /**
   * Toggle one compressor stage in `'split'` mode. With every stage off the split bus collapses to `keyMixer → makeup →
   * destination` and `bgmMixer → makeup → destination` (the per-bus / master compressors are all bypassed but the
   * makeup gain still applies, distinct from the global `'off'` mode that bypasses everything).
   *
   * No-op in `'legacy'` / `'off'` modes — but the state is still remembered, so a later `setMode('split')` picks it up.
   */
  setStageEnabled(stage: CompressorStage, enabled: boolean): void;
  /**
   * Returns the cached stage flag. Reflects the **requested** state even when the active mode isn't `'split'` (so a UI
   * checkbox can round-trip its value through the bus without losing it on a temporary mode change).
   */
  getStageEnabled(stage: CompressorStage): boolean;
  /**
   * Sets the chart-level master gain (BMS `#VOLWAV`). The value is a linear multiplier applied at a dedicated stage
   * that sits BEFORE the recording tap, so a chart authored with `#VOLWAV 80` runs at 80 % through every routing mode
   * and the recorder captures the same attenuated signal the user hears. Passing `1.0` (or omitting the field on the
   * chart) leaves the bus at unity. Negative / non-finite inputs are clamped to `0`.
   */
  setMasterGain(value: number): void;
  /** Returns the currently-applied chart master gain (default `1.0`). */
  getMasterGain(): number;
  /**
   * Fades the **audible** signal path (post-tap, just before `audioContext.destination`) towards `targetGain` over
   * `durationMs`. Used by the gameplay scene's exit transition so the audio dies in lock-step with the screen's
   * `#FADEOUT` alpha animation.
   *
   * Crucially, this stage sits AFTER the recording tap — so a recording in progress keeps capturing the unattenuated
   * mix while the speaker output dips to silence. That matches the user expectation that "saved WAV ≈ what the chart
   * sounds like in full", not "what the user heard during a partial play / abort".
   *
   * Idempotent re-calls re-anchor the ramp at the current value, so a frantic second ESC press just continues the
   * existing fade rather than producing a stair-step.
   */
  fadeOutAudibleTo(targetGain: number, durationMs: number): void;
  /**
   * Restores the post-tap fade gain to unity immediately. The gameplay scene calls this when it cancels an in-flight
   * fade (e.g. a pause that the user then unpauses by mashing keys instead of letting the exit timeline complete) so
   * subsequent audio plays at full level again.
   */
  resetFadeGain(): void;
  dispose(): void;
}

export interface BuildAudioBusOptions {
  /**
   * Initial per-stage flags (only relevant in `'split'` mode). Missing fields default to `true`. Used by hosts that
   * surface a UI for per-stage bypass and want the bus's state to come up matching the pre-mount UI selection.
   */
  initialStages?: Partial<CompressorStages>;
}

/**
 * Builds the audio bus and connects it to `audioContext.destination`. Sample sources should connect to `keyMixer`
 * (player input keysounds) or `bgmMixer` (auto-triggered BGM) and never directly to the destination — that bypasses
 * every compressor stage and the `setMode` toggle won't reach those samples.
 *
 * `initialMode` is the starting mode. Most callers pass `'split'`; the demo's `?compressor=...` flag can pass
 * `'legacy'` or `'off'` for A/B comparison.
 */
export function buildAudioBus(
  audioContext: AudioContext,
  initialMode: CompressorMode = 'split',
  options: BuildAudioBusOptions = {},
): AudioBusHandle {
  const keyMixer = audioContext.createGain();
  const bgmMixer = audioContext.createGain();
    // Sub-unity mixer gain so multiple simultaneous samples don't sum past full scale before the compressor stack has a
  // chance to react. See `MIXER_HEADROOM_GAIN_LINEAR` for why ~−6 dB.
  keyMixer.gain.value = MIXER_HEADROOM_GAIN_LINEAR;
  bgmMixer.gain.value = MIXER_HEADROOM_GAIN_LINEAR;
    // Per-bus compressors plus the master — created up front, wired in/out by `applyMode`. Held even when the active mode
  // doesn't use them so the next `setMode` call can splice them back in without re-creating Web Audio nodes (cheap, but
  // recreating would also reset their internal envelope state which wastes any "warm" gain reduction the mode switch
  // could otherwise preserve).
  const keyComp = createCompressor(audioContext, KEY_BUS_COMPRESSOR_PARAMS);
  const bgmComp = createCompressor(audioContext, BGM_BUS_COMPRESSOR_PARAMS);
  const masterComp = createCompressor(audioContext, MASTER_BUS_COMPRESSOR_PARAMS);
    // Legacy mode reuses a single compressor with the original pre-split params. Distinct node from the master so
  // swapping modes doesn't have to mutate AudioParam values mid-chart.
  const legacyComp = createCompressor(audioContext, LEGACY_COMPRESSOR_PARAMS);
  const makeup = audioContext.createGain();
  makeup.gain.value = MASTER_MAKEUP_GAIN_LINEAR;
    // BMS spec — `#VOLWAV <0..ZZ>` declares the chart's master volume scaling (100 = unity). Implemented as a dedicated
  // gain node placed BEFORE the universal tap so every routing mode (`'off'` / `'legacy'` / `'split'`) feels the
  // attenuation, and the recording tap captures the post-`#VOLWAV` signal — i.e. what the user actually hears.
  // Initialised to unity so charts that omit `#VOLWAV` (or run outside a chart context) are unaffected.
  const masterGain = audioContext.createGain();
  masterGain.gain.value = 1.0;
    // Universal output tap. Every mode routes through this unity- gain node before reaching `audioContext.destination`,
  // so external consumers (the recorder, future analysers, level meters) can `connect` to a single stable point and
  // capture whatever the user is hearing — including `'off'` mode where the makeup gain is bypassed for the audible
  // path. Unity gain means the tap is acoustically transparent: it sums its inputs with no level / phase change, so the
  // "raw signal" intent of `'off'` is preserved.
  const tap = audioContext.createGain();
  tap.gain.value = 1.0;
    // Post-tap fade gain. Splits the "audible" path (which goes to the destination) from the "recording" path (taps off
  // `tap`), so an exit-sequence fade-out can dip the speakers to silence without also pulling the recording mix down.
  // Initialised to unity so steady-state playback is acoustically transparent.
  const exitFadeGain = audioContext.createGain();
  exitFadeGain.gain.value = 1.0;
  masterGain.connect(tap);
  tap.connect(exitFadeGain);
  exitFadeGain.connect(audioContext.destination);
    // `makeup → masterGain → tap` is wired once and never re-disconnected; modes that use makeup (legacy / split) just
  // connect their last compressor to makeup and let the rest of the chain ride.
  makeup.connect(masterGain);

  let activeMode: CompressorMode = initialMode;
    // Stage on/off state. Persisted across mode changes so a UI checkbox can flip the architecture mid-play without
  // forgetting which stages the user had disabled. `initialStages` lets the host seed this from a pre-mount UI
  // selection.
  const stages: CompressorStages = {
    key: options.initialStages?.key ?? true,
    bgm: options.initialStages?.bgm ?? true,
    master: options.initialStages?.master ?? true,
  };
  applyRouting();

  /**
   * Rebuilds every downstream edge based on the current `activeMode` + `stages`. Source-side connections (TO `keyMixer`
   * / `bgmMixer`) stay untouched because `disconnect()` only removes a node's **outgoing** edges, and we never
   * disconnect on the source-side mixers' inputs.
   */
  function applyRouting(): void {
    keyMixer.disconnect();
    bgmMixer.disconnect();
    keyComp.disconnect();
    bgmComp.disconnect();
    masterComp.disconnect();
    legacyComp.disconnect();
    if (activeMode === 'off') {
            // Bypass every compressor + makeup — but route through the master-gain (#VOLWAV) and shared `tap` nodes anyway so
      // the recorder (and any other tap-side consumer) sees the signal. `tap.gain = 1.0` keeps this transparent for the
      // audible path; only `#VOLWAV` modulates volume here.
      keyMixer.connect(masterGain);
      bgmMixer.connect(masterGain);
      return;
    }
    if (activeMode === 'legacy') {
            // keyMixer + bgmMixer → legacyComp → makeup → destination. Stage toggles are intentionally ignored here — legacy
      // is a single-comp architecture, "disable key only" doesn't map onto its topology. The flags persist so toggling
      // back to split mode picks them up.
      keyMixer.connect(legacyComp);
      bgmMixer.connect(legacyComp);
      legacyComp.connect(makeup);
      return;
    }
        // 'split' — 3-stage architecture with per-stage bypass.
    //
    // `stages.key` — engage `keyComp` (else keyMixer skips ahead) `stages.bgm` — engage `bgmComp` (else bgmMixer skips
    // ahead) `stages.master` — engage `masterComp` (else key/BGM tails meet at `makeup`)
    //
    // The branch graph stays the same shape; only which intermediate node each path threads through changes.
    // Sample-source mixers never see the difference.
    const keyTail: AudioNode = stages.key ? keyComp : keyMixer;
    const bgmTail: AudioNode = stages.bgm ? bgmComp : bgmMixer;
    if (stages.key) keyMixer.connect(keyComp);
    if (stages.bgm) bgmMixer.connect(bgmComp);
    if (stages.master) {
      keyTail.connect(masterComp);
      bgmTail.connect(masterComp);
      masterComp.connect(makeup);
    } else {
      keyTail.connect(makeup);
      bgmTail.connect(makeup);
    }
  }

  return {
    keyMixer,
    bgmMixer,
    outputNode: tap,
    get mode(): CompressorMode {
      return activeMode;
    },
    setMode(next: CompressorMode): void {
      if (activeMode === next) return;
      activeMode = next;
      applyRouting();
    },
    getMode(): CompressorMode {
      return activeMode;
    },
    setStageEnabled(stage: CompressorStage, enabled: boolean): void {
      if (stages[stage] === enabled) return;
      stages[stage] = enabled;
            // Only re-route when the active mode is one that uses stage flags. Persisting the flag for legacy/off is the
      // right thing — see the doc comment on `setStageEnabled`.
      if (activeMode === 'split') {
        applyRouting();
      }
    },
    getStageEnabled(stage: CompressorStage): boolean {
      return stages[stage];
    },
    setMasterGain(value: number): void {
            // Sanitise pathological inputs — `#VOLWAV` is documented as `0..ZZ` (linear-scale BMS units, 100 = unity, > 100
      // boosts the chart above unity), but a malformed chart could emit NaN / Infinity / negative numbers that would
      // otherwise propagate into a Web Audio AudioParam and produce silent failure or a runtime exception. Non-finite →
      // unity (no surprise scaling); negative-finite → 0 (silence is the safer interpretation of a negative gain).
      let sanitised: number;
      if (!Number.isFinite(value)) {
        sanitised = 1.0;
      } else if (value < 0) {
        sanitised = 0;
      } else {
        sanitised = value;
      }
      masterGain.gain.value = sanitised;
    },
    getMasterGain(): number {
      return masterGain.gain.value;
    },
    fadeOutAudibleTo(targetGain: number, durationMs: number): void {
            // Re-anchor the ramp at the current value so chained fade-out calls don't snap back to the previous setpoint.
      // `cancelScheduledValues` discards any in-flight ramp, then `setValueAtTime(currentValue, now)` pins the curve to
      // the present audible level before linearly tweening to the target — chosen `linearRampToValueAtTime` over
      // `exponentialRampToValueAtTime` because the screen overlay animates linearly, and we want the visible / audible
      // fades to feel synchronised rather than the audio dying off ahead of the screen.
      const now = audioContext.currentTime;
      const param = exitFadeGain.gain;
      const safeTarget = Number.isFinite(targetGain) ? Math.max(0, targetGain) : 0;
      const safeDurationSeconds = Number.isFinite(durationMs) ? Math.max(0, durationMs) / 1000 : 0;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      if (safeDurationSeconds <= 0) {
                // Zero / negative duration → snap immediately. Avoids `linearRampToValueAtTime` being called with `endTime ===
        // now` which the spec leaves implementation-defined.
        param.setValueAtTime(safeTarget, now);
        return;
      }
      param.linearRampToValueAtTime(safeTarget, now + safeDurationSeconds);
    },
    resetFadeGain(): void {
      const now = audioContext.currentTime;
      const param = exitFadeGain.gain;
      param.cancelScheduledValues(now);
      param.setValueAtTime(1, now);
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
        masterGain.disconnect();
        tap.disconnect();
        exitFadeGain.disconnect();
      } catch {
                // `disconnect()` throws when called on an already-disposed node. Swallowing is safe — `dispose()` is idempotent
        // and the only thing the caller cares about is "no future outputs from this bus".
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
 * Parses a `?compressor=...` URL search-param value into a valid {@link CompressorMode}, or `undefined` when the value
 * is missing / unrecognised so callers can fall through to their default. The demo passes the URL's
 * `searchParams.get('compressor')` here at mount time.
 */
export function parseCompressorMode(raw: string | null | undefined): CompressorMode | undefined {
  if (raw === null || raw === undefined) return undefined;
  const lower = raw.trim().toLowerCase();
  if (lower === 'split' || lower === 'legacy' || lower === 'off') {
    return lower;
  }
  return undefined;
}
