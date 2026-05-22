// Audio playback for `main_state.audio_play / audio_loop / audio_stop` Lua calls.
//
// ModernChic is the heavy user — `Root/customsound.lua` calls `audio_play(skin_config.get_path(
// "Root/sounds/click.ogg"))` from every panel toggle / song change / confirm. Without these
// playing, the menus feel "dead" even though the visuals animate.
//
// Pipeline:
//
//   1. The Lua sandbox calls `audioPlay(path, volume)` via `BeatorajaLuaRuntimeContext` (the path
//      is what `skin_config.get_path(rel)` produced — typically `<skin-root>/Root/sounds/X.ogg`).
//   2. We resolve the path against the bundle's file map (case-insensitive), pull the bytes via
//      `loadAssetBytes` (handles deferred audio entries), and `decodeAudioData` once into an
//      `AudioBuffer`. Both lookups are cached per-path.
//   3. A `BufferSourceNode` plays the cached buffer through a per-player gain node. For loops we
//      keep the source alive in `loopingSources` so `audioStop(path)` can stop them.
//
// The `AudioContext` is created lazily inside the first play attempt — browsers gate
// `AudioContext.resume()` behind a user gesture. The skin Lua's first audio_play typically fires
// from a panel-toggle which IS such a gesture; subsequent plays then succeed even if the very
// first attempt found the context still suspended.

import {
  asLoadedBytes,
  loadAssetBytes,
  lookupBytesCaseInsensitive,
  type BeatorajaSkinFileEntry,
} from '@be-music/beatoraja-skin';

/**
 * Compact bag of audio callbacks scenes pass into their `BeatorajaRenderContext` so Lua
 * `main_state.audio_*` calls fired from BooleanProperty / customEvent closures at draw time
 * route to the host's audio backend. Mirrors the per-method shape of
 * `BeatorajaLuaRuntimeContext.audioPlay / audioLoop / audioStop`. {@link BeatorajaSkinAudioPlayer}
 * implements every method and is the typical injection target.
 */
export interface BeatorajaSkinAudio {
  play: (path: string, vol: number) => boolean;
  loop: (path: string, vol: number) => boolean;
  stop: (path: string) => boolean;
}

export interface BeatorajaSkinAudioPlayerOptions {
  /** Theme bundle's file map. Used to resolve Lua-supplied paths to byte payloads. */
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>;
  /**
   * Optional shared `AudioContext`. When omitted, the player creates and owns its own context
   * lazily on the first play. Pass an existing context (e.g. the select-scene's BGM context) to
   * avoid burning a second device output channel — Safari especially has a tight cap (~6) on
   * concurrent contexts. The player will NOT close a borrowed context in `dispose()`.
   */
  audioContext?: AudioContext;
}

interface PendingDecode {
  promise: Promise<AudioBuffer | undefined>;
}

interface SkinAudioSourceHandle {
  source: AudioBufferSourceNode;
  gain: GainNode | undefined;
}

/**
 * Stateful audio player keyed off a single theme bundle. Construct one per bundle — when the user
 * drops a fresh theme, dispose the old player and create a new one (the cached paths from the
 * old bundle are no longer reachable).
 */
export class BeatorajaSkinAudioPlayer {
  private context: AudioContext | undefined;
  private gain: GainNode | undefined;
  private readonly ownsContext: boolean;
  /** Resolved bundle path (canonical case) → decoded buffer. `null` = decode failed; cached so we
   * don't keep retrying every frame. */
  private readonly buffers = new Map<string, AudioBuffer | null>();
  /** Resolved bundle path → in-flight decode promise (deduplicates concurrent calls). */
  private readonly pending = new Map<string, PendingDecode>();
  /** Active looped sources, keyed by the resolved bundle path. `audioStop(path)` consults this. */
  private readonly loopingSources = new Map<string, Set<SkinAudioSourceHandle>>();
  private disposed = false;

  public constructor(private readonly options: BeatorajaSkinAudioPlayerOptions) {
    this.ownsContext = options.audioContext === undefined;
    this.context = options.audioContext;
  }

  /**
   * Schedule a one-shot play of `path` at volume `vol` (0..1). Returns `true` synchronously when
   * the path is recognized and the play has been scheduled (decoding may still be in flight; the
   * play fires when the decode resolves). Returns `false` when the path doesn't resolve to bytes
   * we can read or when the audio backend is unavailable (Node test env, Safari without a user
   * gesture yet). Mirrors beatoraja's `MainStateAccessor.audio_play` semantics.
   */
  public play(path: string, vol: number): boolean {
    if (this.disposed) return false;
    const resolved = this.resolvePath(path);
    if (resolved === undefined) return false;
    void this.scheduleStart(resolved, vol, false);
    return true;
  }

  /**
   * Same as {@link play} but loops indefinitely until `stop(path)` is called for the same path.
   * Multiple `loop` calls for the same path stack — each gets its own `AudioBufferSourceNode`,
   * and `stop` cancels all of them at once.
   */
  public loop(path: string, vol: number): boolean {
    if (this.disposed) return false;
    const resolved = this.resolvePath(path);
    if (resolved === undefined) return false;
    void this.scheduleStart(resolved, vol, true);
    return true;
  }

  /**
   * Stop every looped source playing `path`. Returns `true` when at least one was stopped.
   * Doesn't affect one-shot sources (they auto-end after their buffer plays); a "stop all" for
   * those isn't necessary in practice — beatoraja's API is loop-centric for `audio_stop`.
   */
  public stop(path: string): boolean {
    if (this.disposed) return false;
    const resolved = this.resolvePath(path);
    if (resolved === undefined) return false;
    const sources = this.loopingSources.get(resolved);
    if (sources === undefined || sources.size === 0) return false;
    for (const handle of sources) {
      try {
        handle.source.stop();
      } catch {
        // Source was already stopped or never started — fine.
      }
      this.disconnectSource(handle);
    }
    sources.clear();
    return true;
  }

  /** Clean up. Stops all looped sources and (when {@link ownsContext}) closes the AudioContext. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const sources of this.loopingSources.values()) {
      for (const handle of sources) {
        try {
          handle.source.stop();
        } catch {
          // Already stopped.
        }
        this.disconnectSource(handle);
      }
    }
    this.loopingSources.clear();
    this.buffers.clear();
    this.pending.clear();
    if (this.gain !== undefined) {
      try {
        this.gain.disconnect();
      } catch {
        // Already disconnected / context closed.
      }
    }
    if (this.ownsContext && this.context !== undefined) {
      void this.context.close().catch(() => undefined);
    }
    this.context = undefined;
    this.gain = undefined;
  }

  /**
   * Case-insensitive bundle-path lookup. Returns the canonical key (the way it appears in the
   * file map) so per-path caches stay deduplicated even when Lua passes mixed-case strings.
   */
  private resolvePath(path: string): string | undefined {
    if (typeof path !== 'string' || path.length === 0) return undefined;
    const entry = lookupBytesCaseInsensitive(this.options.files, path);
    if (entry === undefined) return undefined;
    // Walk the map once to find the canonical key matching this entry. The map is small (a few
    // hundred entries for a typical theme), and we only do this on the first play of each path.
    // After that the buffer cache returns by canonical key directly.
    for (const [key, value] of this.options.files) {
      if (value === entry) return key;
    }
    return path;
  }

  /** Make sure we have a usable AudioContext + gain. Returns undefined when we can't. */
  private ensureContext(): { context: AudioContext; gain: GainNode } | undefined {
    if (this.context === undefined) {
      try {
        this.context = new AudioContext();
      } catch {
        return undefined;
      }
    }
    if (this.gain === undefined) {
      this.gain = this.context.createGain();
      this.gain.gain.value = 1;
      this.gain.connect(this.context.destination);
    }
    return { context: this.context, gain: this.gain };
  }

  /**
   * Decode the bundle bytes once and cache the resulting buffer. Coalesces concurrent calls so
   * a sound triggered repeatedly before the first decode finishes only decodes once.
   */
  private async getBuffer(canonicalPath: string, context: AudioContext): Promise<AudioBuffer | undefined> {
    const cached = this.buffers.get(canonicalPath);
    if (cached !== undefined) return cached === null ? undefined : cached;
    const inFlight = this.pending.get(canonicalPath);
    if (inFlight !== undefined) return inFlight.promise;
    const promise = (async (): Promise<AudioBuffer | undefined> => {
      const entry = this.options.files.get(canonicalPath);
      const bytes = asLoadedBytes(entry) ?? (await loadAssetBytes(entry));
      if (this.disposed) return undefined;
      if (bytes === undefined) {
        this.buffers.set(canonicalPath, null);
        return undefined;
      }
      try {
        // `decodeAudioData` consumes the ArrayBuffer in some browsers; slice a fresh copy so the
        // bundle's original bytes remain re-decodable in case dispose+rebuild happens later.
        const decoded = await context.decodeAudioData(bytes.slice().buffer);
        if (this.disposed) return undefined;
        this.buffers.set(canonicalPath, decoded);
        return decoded;
      } catch {
        if (this.disposed) return undefined;
        // Audio file format unsupported by this browser. Cache the failure as null so we don't
        // keep retrying on every play.
        this.buffers.set(canonicalPath, null);
        return undefined;
      }
    })();
    this.pending.set(canonicalPath, { promise });
    try {
      return await promise;
    } finally {
      this.pending.delete(canonicalPath);
    }
  }

  /** Internal helper: get-or-decode the buffer, then start a source. */
  private async scheduleStart(canonicalPath: string, vol: number, loop: boolean): Promise<void> {
    const audio = this.ensureContext();
    if (audio === undefined) return;
    const buffer = await this.getBuffer(canonicalPath, audio.context);
    if (buffer === undefined || this.disposed) return;
    // Resume in case the autoplay policy left the context suspended — the gesture that triggered
    // this play (panel toggle, song change, etc.) should satisfy it.
    void audio.context.resume().catch(() => undefined);
    const source = audio.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    let perSource: GainNode | undefined;
    if (vol === 1) {
      source.connect(audio.gain);
    } else {
      // Per-source gain so multi-source mixes can run different volumes simultaneously without
      // re-using the shared gain node (which would cross-talk).
      perSource = audio.context.createGain();
      perSource.gain.value = Math.max(0, Math.min(1, vol));
      source.connect(perSource).connect(audio.gain);
    }
    const handle: SkinAudioSourceHandle = { source, gain: perSource };
    try {
      source.start();
    } catch {
      this.disconnectSource(handle);
      return;
    }
    if (loop) {
      let bucket = this.loopingSources.get(canonicalPath);
      if (bucket === undefined) {
        bucket = new Set();
        this.loopingSources.set(canonicalPath, bucket);
      }
      bucket.add(handle);
      source.onended = (): void => {
        bucket?.delete(handle);
        this.disconnectSource(handle);
      };
    } else {
      // Auto-cleanup once the buffer finishes — no manual stop tracking needed for one-shots.
      source.onended = (): void => {
        this.disconnectSource(handle);
      };
    }
  }

  private disconnectSource(handle: SkinAudioSourceHandle): void {
    try {
      handle.source.disconnect();
    } catch {
      // Already disconnected / context closed.
    }
    if (handle.gain !== undefined) {
      try {
        handle.gain.disconnect();
      } catch {
        // Already disconnected / context closed.
      }
    }
  }
}
