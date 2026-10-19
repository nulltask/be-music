/**
 * The player's audio service: every sound outside the chart's samples — the select BGM, the select cues, the decide
 * and result jingles, the chart preview and a beatoraja skin's Lua sounds — on one shared **system** `AudioContext`,
 * plus the per-play graph each play opens for its samples.
 *
 * - **One system context.** Created on first use (a play call, `resume()` or `getContext()`), so a page that has not
 *   had a user gesture yet does not burn a context the browser refuses to start. Every path on it ends in
 *   {@link masterOutput}, so the master volume applies.
 * - **Decoded once.** Encoded sounds are decoded once per bytes (`Uint8Array`) or theme file entry and kept for as long
 *   as the bytes live, so re-entering a scene or replaying a cue does not decode again. A decode that fails is
 *   remembered too, so a sound the browser cannot decode is not retried on every cursor move.
 * - **Owners.** A scene or session passes itself as the `owner` of what it starts, and calls {@link
 *   AudioService.stopOwned} on exit: closing a scene's own context used to silence its sounds, and a shared context
 *   needs that stop to be explicit. A sound started without an owner plays out (the decide cue as the select screen
 *   leaves).
 * - **The play graph.** A play keeps its own `interactive` context and audio bus ({@link createPlayAudioGraph}) for the
 *   lowest key-to-sound latency and so a play's hundreds of sources and its compressors stay apart from the system
 *   sounds; {@link AudioService.openPlayGraph} opens and tracks it. See ADR 0007.
 *
 * Routing on the system context:
 *
 * - BGM → its duck gain (silenced while a preview is audible) → the music bus.
 * - Jingles and the chart preview → the music bus.
 * - The music bus → the master output, and the analyzer (`analyzer`) for audio-reactive skins.
 * - Cues and skin sounds → the cue bus → the master output (not ducked, not analysed).
 */

import {
  asLoadedBytes,
  findCaseInsensitivePath,
  loadAssetBytes,
  type BeatorajaSkinFileEntry,
} from '@be-music/beatoraja-skin';
import type { BeMusicJson } from '@be-music/json';
import type { SystemSound, SystemSoundSet, SystemSoundSlot } from '@be-music/scene-model';
import { ChartPreviewEngine, type ChartPreviewEngineOptions, type ChartPreviewTarget } from '../chart/preview.ts';
import { logger } from '../logger.ts';
import type { BeatorajaSkinAudio } from '../skin/beatoraja/audio.ts';
import { AudioAnalyzer, SILENT_AUDIO, type AudioFeatures } from './audio-analysis.ts';
import type { BuildAudioBusOptions, CompressorMode } from './audio-bus.ts';
import { masterOutput } from './master-volume.ts';
import { createPlayAudioGraph, type PlayAudioGraph } from './play-audio-graph.ts';

const log = logger('audio-service');

/** Who started a sound: a scene or session passes itself, and `stopOwned(owner)` stops what it started. */
export type AudioOwner = object;

/** Where cues and path-only sounds come from: a theme's system sounds and, for a beatoraja theme, its files. */
export interface AudioTheme {
  /** The theme's system sounds; a slot passed to `playCue` / `playBgm` / `playJingle` is looked up here. */
  readonly sounds?: SystemSoundSet;
  /** The theme's files, which path-only sounds and the skin sounds resolve against (case-insensitively). */
  readonly files?: ReadonlyMap<string, BeatorajaSkinFileEntry>;
}

/** A sound to play: one resolved `SystemSound`, or a slot of the theme's sounds (`setTheme`). */
export type AudioSoundRef = SystemSound | SystemSoundSlot;

export interface AudioPlayOptions {
  /** The scene or session the sound belongs to; `stopOwned(owner)` stops it. Without one the sound plays out. */
  readonly owner?: AudioOwner;
  /** Linear level, clamped to `0..1` (default `1`). */
  readonly volume?: number;
}

export interface AudioBgmOptions extends AudioPlayOptions {
  /** Whether the BGM loops (default `true`). */
  readonly loop?: boolean;
  /** Whether the BGM goes silent while a chart preview is audible (default `true`, as LR2's select BGM does). */
  readonly duckUnderPreview?: boolean;
}

/** The beatoraja skin's Lua sounds (`main_state.audio_play` / `audio_loop` / `audio_stop`) on the system context. */
export interface AudioServiceSkinSounds extends BeatorajaSkinAudio {
  /** The same calls, with what they start owned by `owner`: hand this to a beatoraja scene's render context. */
  owned(owner: AudioOwner): BeatorajaSkinAudio;
}

/** The select screen's chart preview: one {@link ChartPreviewEngine} on the system context. */
export interface AudioServicePreview {
  /**
   * Focuses the chart under the cursor; it starts after the focus delay. `undefined` stops it and forgets the focus,
   * so focusing the same chart again re-arms it. The preview belongs to `owner` until the next focus.
   */
  focus(target: ChartPreviewTarget | undefined, owner?: AudioOwner): void;
  /** Stops the preview and forgets the focus. */
  stop(): void;
  /** Whether a preview is audible now. */
  readonly playing: boolean;
}

/** The analysis of the music bus (BGM, jingles and the preview) for audio-reactive skins. */
export interface AudioServiceAnalyzer {
  /** This frame's features, or silence before the system context exists. */
  sample(nowMs: number): AudioFeatures;
}

/** A play's own context and bus ({@link createPlayAudioGraph}), with an analyzer on the bus output. */
export interface PlayAudioHandle extends PlayAudioGraph {
  /** Reads the post-mix signal (the bus's output tap) for audio-reactive skins. */
  readonly analyzer: AudioAnalyzer;
  /**
   * Ends the play's audio: runs `beforeClose` (dispose the play's audio session there), disposes the bus and closes the
   * context, `delayMs` from now so a sample's tail can ring out. Once called, the graph no longer belongs to its owner,
   * so `stopOwned` does not cut the tail. Calling it again does nothing.
   */
  close(options?: { readonly delayMs?: number; readonly beforeClose?: () => void | Promise<void> }): void;
}

/** The part of {@link ChartPreviewEngine} the service drives. */
export interface ChartPreviewPlayer {
  focus(target: ChartPreviewTarget | undefined): void;
  stop(): void;
  dispose(): void;
}

export interface AudioServiceOptions {
  /**
   * Creates the system context. Defaults to an `interactive` `AudioContext` where Web Audio exists; without one (Node,
   * tests) every call is a no-op that reports nothing played.
   */
  readonly createContext?: () => AudioContext | undefined;
  /** Builds a play's context and bus. Defaults to {@link createPlayAudioGraph}. */
  readonly createPlayGraph?: (
    chart: BeMusicJson,
    compressorMode: CompressorMode,
    busOptions?: BuildAudioBusOptions,
  ) => PlayAudioGraph;
  /** Options for the chart preview engine (focus delay, fallback length, looping). */
  readonly preview?: Omit<ChartPreviewEngineOptions, 'onPlaybackStart' | 'onPlaybackStop'>;
  /** Builds the chart preview engine. Defaults to {@link ChartPreviewEngine}. */
  readonly createPreviewEngine?: (
    context: AudioContext,
    output: AudioNode,
    options: ChartPreviewEngineOptions,
  ) => ChartPreviewPlayer;
}

export interface AudioService {
  /** The system context, created on first call; `undefined` where Web Audio is missing or after `dispose`. */
  getContext(): AudioContext | undefined;
  /** Creates the system context if needed and resumes it: call it from the user gesture that unlocks audio. */
  resume(): void;
  /** Decodes encoded audio on the system context, once per `bytes`; `undefined` when it cannot be decoded. */
  decode(bytes: Uint8Array): Promise<AudioBuffer | undefined>;
  /** Sets the theme cues, slot references and skin sounds read from. */
  setTheme(theme: AudioTheme | undefined): void;
  /**
   * Starts the BGM, replacing the one playing. The same sound already playing (or decoding) keeps going: only its
   * owner and level change. Resolves whether it started.
   */
  playBgm(sound: AudioSoundRef | undefined, options?: AudioBgmOptions): Promise<boolean>;
  /** Stops the BGM; with `owner`, only when that owner started it. */
  stopBgm(owner?: AudioOwner): void;
  /**
   * Plays a cue once on the cue bus (a cursor move, a folder, an option panel): a slot of the theme's sounds, or a
   * resolved `SystemSound` (a scene's own sound set). Resolves whether it started.
   */
  playCue(sound: AudioSoundRef | undefined, options?: AudioPlayOptions): Promise<boolean>;
  /** Plays a jingle once (the decide jingle, a result jingle). Resolves whether it started. */
  playJingle(sound: AudioSoundRef | undefined, options?: AudioPlayOptions): Promise<boolean>;
  /** A beatoraja skin's Lua sounds, resolved against the theme's files. */
  readonly skinSounds: AudioServiceSkinSounds;
  /** The select screen's chart preview. */
  readonly preview: AudioServicePreview;
  /** The music bus analysis for audio-reactive skins. */
  readonly analyzer: AudioServiceAnalyzer;
  /**
   * Opens a play's graph: its own `interactive` context and audio bus with the chart's `#VOLWAV`, as
   * {@link createPlayAudioGraph} builds it. Throws where Web Audio is missing, as that does.
   */
  openPlayGraph(
    chart: BeMusicJson,
    compressorMode: CompressorMode,
    busOptions?: BuildAudioBusOptions,
    options?: { readonly owner?: AudioOwner },
  ): PlayAudioHandle;
  /**
   * Stops everything `owner` started: its BGM, jingles, cues and skin sounds (loops included), the preview it
   * focused, and its play graphs that are not closing yet (closed at once).
   */
  stopOwned(owner: AudioOwner): void;
  /** Stops every sound, closes every play graph and the system context. Later calls do nothing. */
  dispose(): void;
}

type VoiceKind = 'bgm' | 'cue' | 'jingle' | 'skin';

/** One sound started on the system context, from the play call until it ends or is stopped. */
interface Voice {
  owner: AudioOwner | undefined;
  readonly kind: VoiceKind;
  /** What it plays: the bytes or the theme file entry (the decode cache key). */
  readonly key: object;
  /** For a skin sound, the canonical theme path (`skinSounds.stop` matches loops by it). */
  readonly path: string | undefined;
  readonly loop: boolean;
  readonly duck: boolean;
  /** Linear level; a replay of the same BGM may change it before the decode lands. */
  volume: number;
  stopped: boolean;
  started: Promise<boolean>;
  source: AudioBufferSourceNode | undefined;
  gain: GainNode | undefined;
}

/** A sound ready to decode: its cache key (bytes or theme file entry) and its decode. */
interface ResolvedSound {
  readonly key: object;
  readonly decode: (context: AudioContext) => Promise<AudioBuffer | undefined>;
}

interface SystemGraph {
  readonly context: AudioContext;
  readonly musicBus: GainNode;
  readonly bgmDuck: GainNode;
  readonly previewBus: GainNode;
  readonly cueBus: GainNode;
  readonly analyzer: AudioAnalyzer;
}

interface OpenPlayGraph {
  owner: AudioOwner | undefined;
  readonly graph: PlayAudioGraph;
  readonly analyzer: AudioAnalyzer;
  closing: boolean;
  closed: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  beforeClose: (() => void | Promise<void>) | undefined;
}

function defaultCreateContext(): AudioContext | undefined {
  if (typeof globalThis.AudioContext !== 'function') return undefined;
  // `interactive` asks for the lowest output latency, as the play graph does: cues answer key presses.
  return new globalThis.AudioContext({ latencyHint: 'interactive' });
}

/** Clamps a level to `0..1`; a missing or non-finite one is unity. */
function sanitizeLevel(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function disconnectQuietly(node: AudioNode | undefined): void {
  try {
    node?.disconnect();
  } catch {
    // Already disconnected, or its context closed first.
  }
}

/** Creates the player's audio service. See the module comment for what it routes where. */
export function createAudioService(options: AudioServiceOptions = {}): AudioService {
  const createContext = options.createContext ?? defaultCreateContext;
  const createPlayGraph = options.createPlayGraph ?? createPlayAudioGraph;
  const createPreviewEngine =
    options.createPreviewEngine ??
    ((context: AudioContext, output: AudioNode, engineOptions: ChartPreviewEngineOptions): ChartPreviewPlayer =>
      new ChartPreviewEngine(context, output, engineOptions));

  let disposed = false;
  let system: SystemGraph | undefined;
  let theme: AudioTheme = {};
  /** Decodes by bytes or theme file entry; held weakly so a dropped theme's sounds can go. */
  const decoded = new WeakMap<object, Promise<AudioBuffer | undefined>>();
  const voices = new Set<Voice>();
  let bgm: Voice | undefined;
  let previewEngine: ChartPreviewPlayer | undefined;
  let previewOwner: AudioOwner | undefined;
  let previewAudible = false;
  const playGraphs = new Set<OpenPlayGraph>();

  function ensureSystem(): SystemGraph | undefined {
    if (disposed) return undefined;
    if (system !== undefined) return system;
    let context: AudioContext | undefined;
    try {
      context = createContext();
    } catch (error) {
      log.warn('system AudioContext unavailable', error);
      return undefined;
    }
    if (context === undefined) return undefined;
    const output = masterOutput(context);
    const musicBus = context.createGain();
    musicBus.connect(output);
    const analyzer = new AudioAnalyzer(context);
    musicBus.connect(analyzer.input);
    const bgmDuck = context.createGain();
    bgmDuck.connect(musicBus);
    const previewBus = context.createGain();
    previewBus.connect(musicBus);
    const cueBus = context.createGain();
    cueBus.connect(output);
    system = { context, musicBus, bgmDuck, previewBus, cueBus, analyzer };
    return system;
  }

  function resumeContext(context: AudioContext): void {
    // Browsers start a context suspended until a user gesture; the gesture that triggered this play satisfies it, and a
    // refusal now is retried by the next play.
    void context.resume().catch(() => undefined);
  }

  function decodeWith(
    context: AudioContext,
    key: object,
    load: () => Promise<Uint8Array | undefined>,
  ): Promise<AudioBuffer | undefined> {
    const cached = decoded.get(key);
    if (cached !== undefined) return cached;
    const promise = (async (): Promise<AudioBuffer | undefined> => {
      const bytes = await load();
      if (bytes === undefined) return undefined;
      try {
        // `decodeAudioData` detaches the buffer it is given in some browsers: decode a copy so the bytes stay usable.
        return await context.decodeAudioData(bytes.slice().buffer);
      } catch (error) {
        log.debug('decode failed', error);
        return undefined;
      }
    })();
    decoded.set(key, promise);
    return promise;
  }

  function decodeBytes(context: AudioContext, bytes: Uint8Array): Promise<AudioBuffer | undefined> {
    return decodeWith(context, bytes, async () => bytes);
  }

  function decodeEntry(context: AudioContext, entry: BeatorajaSkinFileEntry): Promise<AudioBuffer | undefined> {
    return decodeWith(context, entry, async () => asLoadedBytes(entry) ?? (await loadAssetBytes(entry)));
  }

  /** The theme file a path names, with its canonical path, or `undefined` when the theme has no such file. */
  function resolveThemeFile(path: string): { path: string; entry: BeatorajaSkinFileEntry } | undefined {
    const files = theme.files;
    if (files === undefined || typeof path !== 'string' || path.length === 0) return undefined;
    const canonical = findCaseInsensitivePath(files, path);
    if (canonical === undefined) return undefined;
    const entry = files.get(canonical);
    return entry === undefined ? undefined : { path: canonical, entry };
  }

  /** A sound's decode key and loader: its bytes, else its theme file. */
  function resolveSound(ref: AudioSoundRef | undefined): ResolvedSound | undefined {
    const sound = typeof ref === 'string' ? theme.sounds?.[ref] : ref;
    if (sound === undefined) return undefined;
    if (sound.bytes !== undefined) {
      const bytes = sound.bytes;
      return { key: bytes, decode: (context) => decodeBytes(context, bytes) };
    }
    const file = resolveThemeFile(sound.path);
    if (file === undefined) return undefined;
    return { key: file.entry, decode: (context) => decodeEntry(context, file.entry) };
  }

  function release(voice: Voice): void {
    voice.stopped = true;
    voices.delete(voice);
    if (bgm === voice) {
      bgm = undefined;
      applyDuck();
    }
    disconnectQuietly(voice.source);
    disconnectQuietly(voice.gain);
  }

  function stopVoice(voice: Voice): void {
    if (voice.stopped) return;
    voice.stopped = true;
    try {
      voice.source?.stop();
    } catch {
      // Not started yet, or already ended.
    }
    release(voice);
  }

  function destinationOf(graph: SystemGraph, kind: VoiceKind): AudioNode {
    switch (kind) {
      case 'bgm':
        return graph.bgmDuck;
      case 'jingle':
        return graph.musicBus;
      case 'cue':
      case 'skin':
        return graph.cueBus;
    }
  }

  /** Decodes, then starts a voice unless it was stopped meanwhile. */
  async function startVoice(graph: SystemGraph, voice: Voice, sound: ResolvedSound): Promise<boolean> {
    resumeContext(graph.context);
    const buffer = await sound.decode(graph.context);
    if (voice.stopped || disposed) return false;
    if (buffer === undefined) {
      release(voice);
      return false;
    }
    const { context } = graph;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = voice.loop;
    const gain = context.createGain();
    gain.gain.value = voice.volume;
    source.connect(gain);
    gain.connect(destinationOf(graph, voice.kind));
    voice.source = source;
    voice.gain = gain;
    source.onended = (): void => {
      release(voice);
    };
    try {
      source.start();
    } catch (error) {
      log.debug('source start failed', error);
      release(voice);
      return false;
    }
    return true;
  }

  function play(
    kind: VoiceKind,
    resolved: ResolvedSound | undefined,
    playOptions: AudioPlayOptions & { loop?: boolean; duck?: boolean; path?: string },
  ): Voice | undefined {
    if (resolved === undefined) return undefined;
    const graph = ensureSystem();
    if (graph === undefined) return undefined;
    const voice: Voice = {
      owner: playOptions.owner,
      kind,
      key: resolved.key,
      path: playOptions.path,
      loop: playOptions.loop ?? false,
      duck: playOptions.duck ?? false,
      volume: sanitizeLevel(playOptions.volume),
      stopped: false,
      started: Promise.resolve(false),
      source: undefined,
      gain: undefined,
    };
    voices.add(voice);
    voice.started = startVoice(graph, voice, resolved);
    return voice;
  }

  function applyDuck(): void {
    if (system === undefined) return;
    system.bgmDuck.gain.value = previewAudible && bgm !== undefined && bgm.duck ? 0 : 1;
  }

  function playSkinSound(path: string, vol: number, loop: boolean, owner: AudioOwner | undefined): boolean {
    if (disposed) return false;
    const file = resolveThemeFile(path);
    if (file === undefined) return false;
    const { entry } = file;
    const sound: ResolvedSound = { key: entry, decode: (context) => decodeEntry(context, entry) };
    return play('skin', sound, { owner, volume: vol, loop, path: file.path }) !== undefined;
  }

  function stopSkinLoops(path: string): boolean {
    if (disposed) return false;
    const file = resolveThemeFile(path);
    if (file === undefined) return false;
    let stopped = false;
    for (const voice of Array.from(voices)) {
      if (voice.kind !== 'skin' || !voice.loop || voice.path !== file.path) continue;
      stopVoice(voice);
      stopped = true;
    }
    return stopped;
  }

  function skinSoundsFor(owner: AudioOwner | undefined): BeatorajaSkinAudio {
    return {
      play: (path, vol) => playSkinSound(path, vol, false, owner),
      loop: (path, vol) => playSkinSound(path, vol, true, owner),
      stop: (path) => stopSkinLoops(path),
    };
  }

  function ensurePreview(): ChartPreviewPlayer | undefined {
    if (previewEngine !== undefined) return previewEngine;
    const graph = ensureSystem();
    if (graph === undefined) return undefined;
    previewEngine = createPreviewEngine(graph.context, graph.previewBus, {
      ...options.preview,
      onPlaybackStart: () => {
        previewAudible = true;
        applyDuck();
      },
      onPlaybackStop: () => {
        previewAudible = false;
        applyDuck();
      },
    });
    return previewEngine;
  }

  function closePlayGraph(entry: OpenPlayGraph): void {
    if (entry.closed) return;
    entry.closed = true;
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    playGraphs.delete(entry);
    const beforeClose = entry.beforeClose;
    entry.beforeClose = undefined;
    const finish = (): void => {
      entry.analyzer.dispose();
      entry.graph.audioBus.dispose();
      void entry.graph.audioContext.close().catch(() => undefined);
    };
    if (beforeClose === undefined) {
      finish();
      return;
    }
    // The play's audio session stops its sources before the bus and context go.
    void Promise.resolve()
      .then(beforeClose)
      .catch((error: unknown) => log.warn('play audio cleanup failed', error))
      .finally(finish);
  }

  const preview: AudioServicePreview = {
    focus(target, owner) {
      if (disposed) return;
      if (target === undefined) {
        previewEngine?.focus(undefined);
        previewOwner = undefined;
        return;
      }
      const engine = ensurePreview();
      if (engine === undefined) return;
      previewOwner = owner;
      if (system !== undefined) resumeContext(system.context);
      engine.focus(target);
    },
    stop() {
      previewEngine?.focus(undefined);
      previewOwner = undefined;
    },
    get playing() {
      return previewAudible;
    },
  };

  const skinSounds: AudioServiceSkinSounds = {
    ...skinSoundsFor(undefined),
    owned: (owner) => skinSoundsFor(owner),
  };

  return {
    getContext() {
      return ensureSystem()?.context;
    },
    resume() {
      const graph = ensureSystem();
      if (graph !== undefined) resumeContext(graph.context);
    },
    decode(bytes) {
      const graph = ensureSystem();
      return graph === undefined ? Promise.resolve(undefined) : decodeBytes(graph.context, bytes);
    },
    setTheme(next) {
      theme = next ?? {};
    },
    playBgm(sound, bgmOptions = {}) {
      if (disposed) return Promise.resolve(false);
      const loop = bgmOptions.loop ?? true;
      const duck = bgmOptions.duckUnderPreview ?? true;
      const current = bgm;
      const resolved = resolveSound(sound);
      if (current !== undefined && resolved !== undefined && current.key === resolved.key && current.loop === loop) {
        // Already the BGM: a scene entering twice must not stack a second copy.
        current.owner = bgmOptions.owner;
        current.volume = sanitizeLevel(bgmOptions.volume);
        if (current.gain !== undefined) current.gain.gain.value = current.volume;
        return current.started;
      }
      if (current !== undefined) stopVoice(current);
      const voice = play('bgm', resolved, { owner: bgmOptions.owner, volume: bgmOptions.volume, loop, duck });
      if (voice === undefined) return Promise.resolve(false);
      bgm = voice;
      applyDuck();
      return voice.started;
    },
    stopBgm(owner) {
      if (bgm === undefined) return;
      if (owner !== undefined && bgm.owner !== owner) return;
      stopVoice(bgm);
    },
    playCue(sound, playOptions = {}) {
      if (disposed) return Promise.resolve(false);
      return play('cue', resolveSound(sound), playOptions)?.started ?? Promise.resolve(false);
    },
    playJingle(sound, playOptions = {}) {
      if (disposed) return Promise.resolve(false);
      return play('jingle', resolveSound(sound), playOptions)?.started ?? Promise.resolve(false);
    },
    skinSounds,
    preview,
    analyzer: {
      sample(nowMs) {
        return system === undefined ? SILENT_AUDIO : system.analyzer.sample(nowMs);
      },
    },
    openPlayGraph(chart, compressorMode, busOptions, graphOptions = {}) {
      const graph = createPlayGraph(chart, compressorMode, busOptions);
      const analyzer = new AudioAnalyzer(graph.audioContext);
      graph.audioBus.outputNode.connect(analyzer.input);
      const entry: OpenPlayGraph = {
        owner: graphOptions.owner,
        graph,
        analyzer,
        closing: false,
        closed: false,
        timer: undefined,
        beforeClose: undefined,
      };
      playGraphs.add(entry);
      return {
        audioContext: graph.audioContext,
        audioBus: graph.audioBus,
        analyzer,
        close(closeOptions = {}) {
          if (entry.closing) return;
          entry.closing = true;
          entry.owner = undefined;
          entry.beforeClose = closeOptions.beforeClose;
          const delayMs = closeOptions.delayMs ?? 0;
          if (!Number.isFinite(delayMs) || delayMs <= 0) {
            closePlayGraph(entry);
            return;
          }
          entry.timer = setTimeout(() => {
            entry.timer = undefined;
            closePlayGraph(entry);
          }, delayMs);
        },
      };
    },
    stopOwned(owner) {
      for (const voice of Array.from(voices)) {
        if (voice.owner === owner) stopVoice(voice);
      }
      if (previewOwner === owner) preview.stop();
      for (const entry of Array.from(playGraphs)) {
        if (!entry.closing && entry.owner === owner) {
          entry.closing = true;
          closePlayGraph(entry);
        }
      }
    },
    dispose() {
      if (disposed) return;
      for (const voice of Array.from(voices)) stopVoice(voice);
      disposed = true;
      previewEngine?.dispose();
      previewEngine = undefined;
      previewOwner = undefined;
      previewAudible = false;
      for (const entry of Array.from(playGraphs)) {
        entry.closing = true;
        closePlayGraph(entry);
      }
      theme = {};
      if (system !== undefined) {
        const { context, musicBus, bgmDuck, previewBus, cueBus, analyzer } = system;
        system = undefined;
        analyzer.dispose();
        for (const node of [bgmDuck, previewBus, cueBus, musicBus]) disconnectQuietly(node);
        void context.close().catch(() => undefined);
      }
    },
  };
}
