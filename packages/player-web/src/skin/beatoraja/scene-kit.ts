/**
 * Loading one entry of a beatoraja theme for a scene: its **scene kit** ({@link BeatorajaSceneKit}), what the beatoraja
 * family draws a select, decide, play or result screen with.
 *
 * A host keeps one {@link BeatorajaSceneKitCaches} and calls {@link loadBeatorajaSceneKit} each time it makes a
 * beatoraja scene:
 *
 * 1. The skin is loaded twice. The first pass, without options, gives its header (`property[]`, `filepath[]`,
 *    `offset[]`), whose defaults seed the player's options for the entry ({@link resolveBeatorajaSkinConfig}). The
 *    second pass runs a Lua skin's `main()` with those options, so its `source[]` and `destination[]` are built for
 *    them. Options the host already holds (an options panel's change) load it once.
 * 2. The skin's `source[]` is resolved against the theme's files (`bundleBeatorajaSources`) and decoded to textures.
 * 3. Its `font[]` is registered.
 *
 * Textures, fonts and options are kept per entry path, so the next scene on the same entry reuses them. Textures are
 * never destroyed (see `textures.ts`): a new theme only forgets them ({@link releaseBeatorajaSceneKitAssets}).
 */

import {
  buildBaseOpSet,
  buildDefaultSkinConfigFiles,
  buildDefaultSkinConfigOptions,
  bundleBeatorajaSources,
  loadBeatorajaSkin,
  normalizeBeatorajaFonts,
  type BeatorajaLuaRuntimeContext,
  type BeatorajaSkin,
  type BeatorajaSkinConfig,
  type BeatorajaSkinFileEntry,
  type BeatorajaSkinHeader,
  type BeatorajaSourceBundle,
} from '@be-music/beatoraja-skin';
import { beatorajaDifficultyOps } from '@be-music/beatoraja-skin/scene';
import type { BeatorajaSkinAudio } from './audio.ts';
import { loadBeatorajaFonts, type BeatorajaFontCache } from './fonts.ts';
import { loadBeatorajaTexturesFromBundle, type BeatorajaTextureCache } from './textures.ts';

/** One entry of a beatoraja theme, loaded for a scene. */
export interface BeatorajaSceneKit {
  /** The parsed skin of the entry (`header.type` matching the scene). */
  readonly skin: BeatorajaSkin;
  readonly textures: BeatorajaTextureCache;
  readonly fonts?: BeatorajaFontCache;
  /** The player's picks for the skin's options (`property[]`). */
  readonly skinConfig?: BeatorajaSkinConfig;
  /** The theme's files: the Lua `main_state.audio_*` sounds and the theme's path-only system sounds are read from them. */
  readonly files: ReadonlyMap<string, BeatorajaSkinFileEntry>;
}

/** What a host keeps between scene kit loads, each keyed by the entry's path (`BeatorajaSkinEntry.entryPath`). */
export interface BeatorajaSceneKitCaches {
  /** The decoded textures. Never destroyed: see `textures.ts`. */
  readonly textures: Map<string, BeatorajaTextureCache>;
  /** The registered fonts. */
  readonly fonts: Map<string, BeatorajaFontCache>;
  /**
   * The player's options: seeded from the entry's header on its first load, then replaced by the host when the player
   * changes them (an options panel, a skin's own button). A select skin and a play skin keep their own.
   */
  readonly skinConfigs: Map<string, BeatorajaSkinConfig>;
}

/** Empty caches for {@link loadBeatorajaSceneKit}. */
export function createBeatorajaSceneKitCaches(): BeatorajaSceneKitCaches {
  return { textures: new Map(), fonts: new Map(), skinConfigs: new Map() };
}

/**
 * Forgets the decoded textures and disposes the registered fonts, for a new theme. The textures are dropped, not
 * destroyed (see `textures.ts`), and the fonts leave `document.fonts` and Pixi's bitmap-font cache. The player's options
 * stay, as they are kept by entry path.
 */
export function releaseBeatorajaSceneKitAssets(caches: BeatorajaSceneKitCaches): void {
  caches.textures.clear();
  for (const fonts of caches.fonts.values()) fonts.dispose();
  caches.fonts.clear();
}

/**
 * The options an entry starts with: each `property[]`'s default item, each `filepath[]`'s default file, no timing offset
 * and no custom offsets. The default file is matched against the theme's files, so the author's default wins over the
 * first file a wildcard sorts to (ModernChic's `key` filepath would otherwise pick `#default.png` over `harf.png`).
 */
export function defaultBeatorajaSkinConfig(
  header: BeatorajaSkinHeader,
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  entryPath: string,
): BeatorajaSkinConfig {
  const file = buildDefaultSkinConfigFiles(header, files, entryPath);
  // `customOffset` starts empty (an options panel zero-fills each slot when it is built), so a kept config and one the
  // panel sends back have the same keys.
  return { offset: 0, option: buildDefaultSkinConfigOptions(header), file, customOffset: {} };
}

/**
 * The player's options for an entry: the kept ones, or the defaults of its header ({@link defaultBeatorajaSkinConfig}),
 * kept from then on. The returned object is the kept one.
 */
export function resolveBeatorajaSkinConfig(
  caches: Pick<BeatorajaSceneKitCaches, 'skinConfigs'>,
  entryPath: string,
  header: BeatorajaSkinHeader,
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
): BeatorajaSkinConfig {
  let config = caches.skinConfigs.get(entryPath);
  if (config === undefined) {
    config = defaultBeatorajaSkinConfig(header, files, entryPath);
    caches.skinConfigs.set(entryPath, config);
  }
  return config;
}

/** What {@link createBeatorajaSkinLoadContext} builds the load-time `main_state` from. */
export interface BeatorajaSkinLoadContextOptions {
  /** The chart's `#DIFFICULTY` (1 BEGINNER … 5 INSANE); `DIFFICULTY_UNDEFINED` without one. */
  readonly difficulty?: number;
  /** The options the skin is loaded with; their ops are lit. */
  readonly skinConfig: BeatorajaSkinConfig;
  /** Plays the Lua `main_state.audio_play` / `audio_loop` / `audio_stop` sounds; without one they do nothing. */
  readonly skinAudio?: BeatorajaSkinAudio;
}

/**
 * The `main_state` a skin sees while its `main()` runs, for skins that work values out at load time. ModernChic's
 * decide and result skins, for one, look up a colour by `main_state.option(DIFFICULTY*)` and fail to load when no
 * difficulty op is lit. It lights the chart's difficulty ops (`beatorajaDifficultyOps`) and the options' ops, and
 * routes the Lua sounds to `skinAudio`; every other accessor keeps its default.
 */
export function createBeatorajaSkinLoadContext(options: BeatorajaSkinLoadContextOptions): BeatorajaLuaRuntimeContext {
  const ops = new Set(buildBaseOpSet(options.skinConfig.option));
  for (const op of beatorajaDifficultyOps(options.difficulty)) ops.add(op);
  const audio = options.skinAudio;
  return {
    option: (id) => ops.has(id),
    audioPlay: audio === undefined ? undefined : (path, vol) => audio.play(path, vol),
    audioLoop: audio === undefined ? undefined : (path, vol) => audio.loop(path, vol),
    audioStop: audio === undefined ? undefined : (path) => audio.stop(path),
  };
}

/** What {@link loadBeatorajaSceneKit} loads and how. */
export interface LoadBeatorajaSceneKitOptions {
  /** The theme's files (`BeatorajaThemeBundle.files`). */
  readonly files: ReadonlyMap<string, BeatorajaSkinFileEntry>;
  /** The entry to load (`BeatorajaSkinEntry.entryPath`); the caches are keyed by it. */
  readonly entryPath: string;
  readonly caches: BeatorajaSceneKitCaches;
  /**
   * The options to load the skin with, loading it once. Without them it is loaded twice, the first time for the header
   * whose defaults seed the kept options ({@link resolveBeatorajaSkinConfig}).
   */
  readonly skinConfig?: BeatorajaSkinConfig;
  /**
   * The `main_state` the skin sees while its `main()` runs ({@link createBeatorajaSkinLoadContext}), made from the
   * options it is loaded with. Only the load with options gets it; without one `main_state` reads its defaults.
   */
  readonly runtimeContext?: (skinConfig: BeatorajaSkinConfig) => BeatorajaLuaRuntimeContext;
  /** Decode the textures again even when they are kept: other options can build another `source[]`. */
  readonly reloadTextures?: boolean;
  /** Called with the resolved `source[]` when the textures are decoded, for the host's log. */
  readonly onSources?: (sources: BeatorajaSourceBundle) => void;
  /** Called when the fonts are registered, with how many the skin declares, for the host's log. */
  readonly onFonts?: (fonts: BeatorajaFontCache, declared: number) => void;
}

/** A loaded scene kit: the fonts are registered and the options are the ones the skin was loaded with. */
export interface LoadedBeatorajaSceneKit extends BeatorajaSceneKit {
  readonly fonts: BeatorajaFontCache;
  readonly skinConfig: BeatorajaSkinConfig;
}

/**
 * The outcome of {@link loadBeatorajaSceneKit}: the kit with the entry's header (for an options panel), or why it could
 * not be loaded: `stage` says whether the header pass or the skin itself failed.
 */
export type LoadBeatorajaSceneKitResult =
  | { readonly ok: true; readonly kit: LoadedBeatorajaSceneKit; readonly header: BeatorajaSkinHeader }
  | { readonly ok: false; readonly stage: 'header' | 'skin'; readonly message: string };

/** Loads one entry of a beatoraja theme as a scene kit. See the module comment. */
export async function loadBeatorajaSceneKit(
  options: LoadBeatorajaSceneKitOptions,
): Promise<LoadBeatorajaSceneKitResult> {
  const { files, entryPath, caches } = options;
  let header: BeatorajaSkinHeader | undefined;
  let skinConfig = options.skinConfig;
  if (skinConfig === undefined) {
    // The header pass picks up the skin's `property[]` schema; the second pass re-runs `main()` with the option picks so
    // dynamic `source[]` / `destination[]` populate.
    const headerLoad = loadBeatorajaSkin({ entryPath, files });
    if (!headerLoad.ok) return { ok: false, stage: 'header', message: headerLoad.error.message };
    header = headerLoad.header;
    skinConfig = resolveBeatorajaSkinConfig(caches, entryPath, header, files);
  }
  const load = loadBeatorajaSkin({
    entryPath,
    files,
    skinConfig,
    ...(options.runtimeContext !== undefined ? { runtimeContext: options.runtimeContext(skinConfig) } : {}),
  });
  if (!load.ok || !load.skin) {
    return { ok: false, stage: 'skin', message: load.ok ? 'skin payload missing' : load.error.message };
  }
  const skin = load.skin;

  // Option changes can alter `source[]`, so a reload drops the kept textures before decoding them again.
  if (options.reloadTextures === true) caches.textures.delete(entryPath);
  let textures = caches.textures.get(entryPath);
  if (textures === undefined) {
    const sources = bundleBeatorajaSources({
      files,
      entryPath,
      sources: (skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
      filepathSchema: skin.filepath,
      // The options' `filepath[]` picks choose the files of the wildcards they name: on the first load, the header's
      // default file of each.
      filepathOverrides: skinConfig.file,
    });
    options.onSources?.(sources);
    textures = await loadBeatorajaTexturesFromBundle(sources);
    caches.textures.set(entryPath, textures);
  }

  // TTFs are small and a registered FontFace outlives every scene anyway, so fonts are kept per entry as textures are.
  let fonts = caches.fonts.get(entryPath);
  if (fonts === undefined) {
    const declared = normalizeBeatorajaFonts(skin.font);
    fonts = await loadBeatorajaFonts({ files, entryPath, fonts: declared });
    options.onFonts?.(fonts, declared.length);
    caches.fonts.set(entryPath, fonts);
  }

  return { ok: true, kit: { skin, textures, fonts, skinConfig, files }, header: header ?? load.header };
}
