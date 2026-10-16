/**
 * The select screen's sound on the built-in and LR2 select scenes: the looping select BGM, the one-shot system cues
 * (cursor, folder, option panel, decide) and the focused chart's preview. They play on one AudioContext of the scene's
 * own, made on first use, as a browser starts audio only after a gesture. The preview ducks the BGM while it plays, and
 * an analyser taps the BGM and the preview for audio-reactive be-music skins.
 *
 * The audio reads the select scene through {@link SelectAudioContext}; the scene passes it.
 */

import { ChartPreviewEngine } from '../../../chart/preview.ts';
import { resolveSongSource } from '../../../collection/collection.ts';
import type { BrowserSongCollection, BrowserSongEntry } from '../../../collection/types.ts';
import { logger } from '../../../logger.ts';
import { AudioAnalyzer } from '../../../runtime/audio-analysis.ts';
import { masterOutput } from '../../../runtime/master-volume.ts';
import type { PixiSongSelectSystemSounds } from '../select.ts';

const log = logger('select');

/** What the audio reads on the select scene: its fields and methods of these names. */
export interface SelectAudioContext {
  readonly disposed: boolean;
  /** Whether the select is the scene showing: the BGM and the preview play only then. */
  readonly visible: boolean;
  readonly collection: BrowserSongCollection;
  focusedSong(): BrowserSongEntry | undefined;
}

/** The select screen's sound. See the module comment. */
export class SelectAudio {
  private readonly ctx: SelectAudioContext;

  /**
   * Encoded select-screen BGM bytes (typically WAV / OGG). Set via the `selectBgm` constructor option or {@link
   * setSelectBgm}; decoded lazily on the first user gesture so we don't trip the browser's autoplay policy on mount.
   */
  selectBgmBytes: Uint8Array | undefined;
  /**
   * Decoded BGM buffer. Populated once after a successful `decodeAudioData`; `setSelectBgm` invalidates it when new
   * bytes arrive.
   */
  private selectBgmBuffer: AudioBuffer | undefined;
  /**
   * Active source node for the looping BGM. Nullable because Web Audio `BufferSourceNode`s are one-shot — pausing means
   * stopping the current source and constructing a fresh one on resume. Holds a reference so `pauseSelectBgm` can stop
   * it cleanly without leaking residual playback into hidden state.
   */
  private selectBgmSource: AudioBufferSourceNode | undefined;
  /**
   * AudioContext owned by this view, created lazily inside `ensureSelectBgmContext` on the first user gesture. Distinct
   * from gameplay's AudioContext so the two scenes' audio lifecycles don't tangle (gameplay closes its context on
   * dispose; the select view persists across plays).
   */
  private selectBgmContext: AudioContext | undefined;
  /**
   * Master gain for the select BGM. ~0.5 keeps it audible without drowning out future preview-sample playback we might
   * add at the same time. Held as a node ref so the volume can be tweaked at runtime if the demo wires a slider later.
   */
  private selectBgmGain: GainNode | undefined;
  /**
   * `true` when a decode pass is in flight. Suppresses redundant decodes while the user mashes keys before the first
   * one resolves.
   */
  private selectBgmDecodeInFlight = false;
  /**
   * Lazily-constructed song-preview engine — fires the focused chart's `#PREVIEW` audio (or, when absent, schedules the
   * chart's keysounds in-place) after the LR2 focus-settle delay. Built once on the first cursor settle so the
   * AudioContext is shared with the select BGM, and disposed with the scene.
   */
  chartPreviewEngine: ChartPreviewEngine | undefined;
  /**
   * Output gain for the preview engine. Routed in parallel with the BGM gain to `audioContext.destination` so the two
   * can mix-down together; the value sits at unity so the chart's encoded loudness reaches the user as authored. Held
   * as a field so we can duck the BGM (zero its gain) for the duration of any active preview playback.
   */
  private chartPreviewGain: GainNode | undefined;
  /** Analyser tapping the BGM + chart preview for audio-reactive be-music skins (not the one-shot system cues). */
  selectAudioAnalyzer: AudioAnalyzer | undefined;
  /**
   * `selectBgmGain.gain.value` captured at the moment the preview engine reported `onPlaybackStart`. Restored when
   * playback stops so the BGM returns to whatever level the host configured (rather than overwriting it with our
   * default-knee).
   */
  private bgmGainBeforeDuck: number | undefined;
  /**
   * Master gain for one-shot system effects (`cursor-move` / `folder-open` / `folder-close` / `option-open` /
   * `option-close` / `option-change` / `decide`). Routed straight to `audioContext.destination` in parallel with
   * `selectBgmGain` and `chartPreviewGain` — that way the BGM-duck on preview-start (which zeros `selectBgmGain.gain`)
   * doesn't also silence the effect cues. Held as a field so a future master-volume slider can attenuate effects
   * independently of music.
   */
  private systemSoundGain: GainNode | undefined;
  /**
   * Encoded one-shot sound effects keyed by name. Stems include `'decide'` (select → gameplay cue) and the LR2 system
   * effects (`'cursor-move'` / `'folder-open'` / `'folder-close'` / `'option-open'` / `'option-close'` /
   * `'option-change'` — see `LR2files\Sound\lr2\*.wav` in the default theme). All one-shots share the same
   * `AudioContext` as the looping select BGM but route through the dedicated {@link systemSoundGain} so preview ducking
   * doesn't silence them. Buffers decode lazily on first use.
   */
  private readonly oneShotBytes = new Map<string, Uint8Array>();
  /** Decoded buffer cache, parallel to {@link oneShotBytes}. */
  private readonly oneShotBuffers = new Map<string, AudioBuffer>();
  /**
   * Names whose decode pass is in flight. Prevents redundant `decodeAudioData` calls when the same sound is fired
   * multiple times before the first decode resolves.
   */
  private readonly oneShotDecoding = new Set<string>();

  public constructor(ctx: SelectAudioContext) {
    this.ctx = ctx;
  }

  /** See `CoreSongSelectView.setSelectBgm`. */
  setSelectBgm(bytes: Uint8Array | undefined): void {
    if (this.selectBgmBytes === bytes) return;
    this.stopSelectBgm();
    this.selectBgmBytes = bytes;
    this.selectBgmBuffer = undefined;
    if (bytes && this.ctx.visible) {
      // Trigger decode + start eagerly. If autoplay policy hasn't been satisfied yet (no user gesture) the AudioContext
      // stays suspended; the next pointerdown / keydown handler resumes it via `ensureSelectBgmContext`.
      void this.startSelectBgm();
    }
  }

  /** See `CoreSongSelectView.setSystemSounds`. */
  setSystemSounds(sounds: PixiSongSelectSystemSounds | undefined): void {
    this.setOneShotBytes('cursor-move', sounds?.cursorMove);
    this.setOneShotBytes('folder-open', sounds?.folderOpen);
    this.setOneShotBytes('folder-close', sounds?.folderClose);
    this.setOneShotBytes('option-open', sounds?.optionOpen);
    this.setOneShotBytes('option-close', sounds?.optionClose);
    this.setOneShotBytes('option-change', sounds?.optionChange);
  }

  /**
   * Stores or clears the encoded bytes for a one-shot sound. We also drop the decoded buffer so the next
   * `playOneShotSound` call decodes from scratch — without that a swap would silently keep playing the old sound until
   * the cache happened to be invalidated some other way.
   */
  setOneShotBytes(name: string, bytes: Uint8Array | undefined): void {
    if (bytes === undefined) {
      this.oneShotBytes.delete(name);
    } else {
      this.oneShotBytes.set(name, bytes);
    }
    this.oneShotBuffers.delete(name);
  }

  /**
   * Plays the named one-shot sound (no loop). Decodes lazily on first call and caches the buffer for subsequent plays —
   * cursor-move clicks fire dozens of times per minute on a fast scroll, so the decode-once / replay-many pattern is
   * worth the cache.
   *
   * No-op when:
   *
   * - The sound's bytes are unset (the theme didn't ship that effect) — `oneShotBytes.get(name)` returns undefined.
   * - The `AudioContext` can't be created (e.g. Node test env).
   * - A decode pass for the same name is already in flight; the next caller after the decode resolves will succeed.
   * - The `AudioContext` is still suspended because no user gesture has unlocked it. In practice every trigger site
   *   (cursor / folder navigation, song decide) IS such a gesture, so the resume always lands here.
   */
  async playOneShotSound(name: string): Promise<void> {
    if (this.ctx.disposed) return;
    const bytes = this.oneShotBytes.get(name);
    if (!bytes) return;
    const audioContext = this.ensureSelectBgmContext();
    if (!audioContext) return;
    let buffer = this.oneShotBuffers.get(name);
    if (!buffer) {
      if (this.oneShotDecoding.has(name)) return;
      this.oneShotDecoding.add(name);
      try {
        buffer = await audioContext.decodeAudioData(bytes.slice().buffer);
        if (this.ctx.disposed) return;
        this.oneShotBuffers.set(name, buffer);
      } catch (error) {
        log.warn(`one-shot "${name}" decode failed`, error);
        return;
      } finally {
        this.oneShotDecoding.delete(name);
      }
    }
    // Resume in case autoplay policy left the context suspended — the gesture that triggered this play should satisfy
    // it.
    void audioContext.resume().catch(() => undefined);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    // Route through the dedicated system-FX gain so the duck-on- preview-start (which zeros `selectBgmGain.gain`)
    // doesn't also silence the cue. Falls through to destination if the FX gain hasn't been constructed yet (shouldn't
    // happen in practice — `ensureSelectBgmContext` builds both atomically).
    source.connect(this.systemSoundGain ?? masterOutput(audioContext));
    source.start();
    // Auto-disconnect on natural end so the node is GC-eligible.
    source.onended = (): void => {
      try {
        source.disconnect();
      } catch {
        // Already disconnected (dispose path) — fine.
      }
    };
  }

  /**
   * Starts the looping select-screen BGM. Idempotent — safe to call repeatedly; only the first call after a stop
   * reaches the decode + `start()` codepath. No-op when `selectBgmBytes` is unset (host didn't supply BGM).
   *
   * Browsers gate `AudioContext.resume()` behind a user gesture; if this is called before any pointer / key event the
   * context stays suspended and playback waits silently. The first user gesture in `handlePointerDown` /
   * `handleKeyDown` calls this again so the resume actually lands inside the gesture handler.
   */
  async startSelectBgm(): Promise<void> {
    if (this.ctx.disposed) return;
    if (!this.selectBgmBytes) return;
    if (this.selectBgmSource) return;
    const audioContext = this.ensureSelectBgmContext();
    if (!audioContext) return;
    // Decode lazily on first start. The `selectBgmDecodeInFlight` guard short-circuits parallel decode attempts when
    // several gestures land before the first decode resolves.
    if (!this.selectBgmBuffer) {
      if (this.selectBgmDecodeInFlight) return;
      this.selectBgmDecodeInFlight = true;
      try {
        // `decodeAudioData` consumes the ArrayBuffer in some browsers (detaches it). Slice a fresh copy so re-decoding
        // after `setSelectBgm(sameBytes)` still works.
        const buffer = await audioContext.decodeAudioData(this.selectBgmBytes.slice().buffer);
        if (this.ctx.disposed) return;
        this.selectBgmBuffer = buffer;
      } catch (error) {
        log.warn('BGM decode failed', error);
        return;
      } finally {
        this.selectBgmDecodeInFlight = false;
      }
    }
    if (!this.ctx.visible) return; // Hidden during decode — bail.
    // Resume in case a previous `pause` or autoplay-blocked init left the context suspended. Errors (e.g. still no user
    // gesture) are swallowed; the next gesture-driven call will retry.
    void audioContext.resume().catch(() => undefined);
    const source = audioContext.createBufferSource();
    source.buffer = this.selectBgmBuffer;
    source.loop = true;
    source.connect(this.selectBgmGain ?? masterOutput(audioContext));
    source.start();
    this.selectBgmSource = source;
  }

  /**
   * Pauses the BGM by stopping the active source. Web Audio `BufferSourceNode`s are one-shot, so resume rebuilds a
   * fresh source from the cached `selectBgmBuffer` — no re-decode.
   */
  pauseSelectBgm(): void {
    if (!this.selectBgmSource) return;
    try {
      this.selectBgmSource.stop();
    } catch {
      // `stop()` throws when called on a node that hasn't started or has already stopped. Both states are fine for our
      // purposes; we just want the source gone.
    }
    this.selectBgmSource.disconnect();
    this.selectBgmSource = undefined;
  }

  /**
   * Hard-stops the BGM and forgets the decoded buffer. Used when the BGM bytes themselves change — the next start call
   * will decode from scratch.
   */
  private stopSelectBgm(): void {
    this.pauseSelectBgm();
    this.selectBgmBuffer = undefined;
  }

  /**
   * Constructs (lazily) the AudioContext + master gain that the BGM plays through. Returns `undefined` if
   * `AudioContext` isn't available (Node test environments etc.) so callers degrade gracefully into a "no BGM" mode.
   */
  private ensureSelectBgmContext(): AudioContext | undefined {
    if (this.selectBgmContext) return this.selectBgmContext;
    if (typeof globalThis.AudioContext === 'undefined') return undefined;
    const audioContext = new globalThis.AudioContext();
    const gain = audioContext.createGain();
    // ~-6 dB so the BGM doesn't drown out future preview-sample playback we might add at the same time. Adjustable via
    // a future runtime knob if the demo wires a slider.
    gain.gain.value = 0.5;
    gain.connect(masterOutput(audioContext));
    this.selectBgmContext = audioContext;
    this.selectBgmGain = gain;
    this.selectAudioAnalyzer = new AudioAnalyzer(audioContext);
    gain.connect(this.selectAudioAnalyzer.input);
    // System-effect bus — sibling of `selectBgmGain`, routed directly to destination so the preview-start BGM duck
    // (which zeros `selectBgmGain.gain`) doesn't also silence cursor / folder / option cues.
    const fxGain = audioContext.createGain();
    fxGain.gain.value = 1;
    fxGain.connect(masterOutput(audioContext));
    this.systemSoundGain = fxGain;
    return audioContext;
  }

  /**
   * Constructs the preview engine + its master gain on the same AudioContext as the select BGM. Returns `undefined`
   * when AudioContext isn't available (Node tests) so callers can silently skip preview wiring.
   *
   * The preview gain is a sibling of `selectBgmGain` rather than a child of it: routing both to
   * `audioContext.destination` directly keeps the BGM ducking logic (zeroing `selectBgmGain.gain.value` while preview
   * plays) from also attenuating the preview output. Unity gain on the preview side preserves the chart's encoded
   * loudness.
   */
  private ensureChartPreviewEngine(): ChartPreviewEngine | undefined {
    if (this.chartPreviewEngine) return this.chartPreviewEngine;
    if (this.ctx.disposed) return undefined;
    const audioContext = this.ensureSelectBgmContext();
    if (!audioContext) return undefined;
    const gain = audioContext.createGain();
    gain.gain.value = 1;
    gain.connect(masterOutput(audioContext));
    if (this.selectAudioAnalyzer) gain.connect(this.selectAudioAnalyzer.input);
    this.chartPreviewGain = gain;
    this.chartPreviewEngine = new ChartPreviewEngine(audioContext, gain, {
      onPlaybackStart: () => {
        // Duck the BGM to silence while a preview is audible. We capture the pre-duck level so a future host-side
        // volume tweak (e.g. a slider that updates `selectBgmGain.gain`) is restored verbatim, not overwritten with the
        // constructor default.
        if (this.selectBgmGain && this.bgmGainBeforeDuck === undefined) {
          this.bgmGainBeforeDuck = this.selectBgmGain.gain.value;
          this.selectBgmGain.gain.value = 0;
        }
      },
      onPlaybackStop: () => {
        if (this.selectBgmGain && this.bgmGainBeforeDuck !== undefined) {
          this.selectBgmGain.gain.value = this.bgmGainBeforeDuck;
          this.bgmGainBeforeDuck = undefined;
        }
      },
    });
    return this.chartPreviewEngine;
  }

  /**
   * Hands the engine the song currently under the cursor (or `undefined` when the cursor sits on a folder bar). The
   * engine swallows redundant focuses internally — calling this on every cursor move is cheap, and centralizing the
   * call here means new focus-changing call sites (`setNavigation`, `setCollection`) only have to invoke this single
   * helper.
   *
   * Skipped while the scene is hidden — there's no scenario in which we want a preview firing through a hidden select
   * view (every re-entry re-arms it in {@link enter}).
   */
  refreshChartPreview(): void {
    if (this.ctx.disposed || !this.ctx.visible) return;
    const song = this.ctx.focusedSong();
    if (!song) {
      this.chartPreviewEngine?.focus(undefined);
      return;
    }
    const engine = this.ensureChartPreviewEngine();
    if (!engine) return;
    const source = resolveSongSource(this.ctx.collection, song);
    if (!source) {
      engine.focus(undefined);
      return;
    }
    engine.focus({ song, source });
  }

  /** Stops the BGM and the preview and closes the AudioContext, for `CoreSongSelectView.dispose`. */
  dispose(): void {
    // Tear down BGM + preview playback before scene-graph teardown so no `BufferSourceNode` outlives the view. The
    // preview engine MUST go first — it shares this AudioContext, and disposing it after the context is closed throws
    // inside `disconnect()`.
    this.chartPreviewEngine?.dispose();
    this.chartPreviewEngine = undefined;
    this.chartPreviewGain = undefined;
    this.bgmGainBeforeDuck = undefined;
    this.pauseSelectBgm();
    this.selectAudioAnalyzer?.dispose();
    this.selectAudioAnalyzer = undefined;
    void this.selectBgmContext?.close().catch(() => undefined);
    this.selectBgmContext = undefined;
    this.selectBgmGain = undefined;
    this.systemSoundGain = undefined;
    this.selectBgmBuffer = undefined;
  }
}
