// Browser-side wiring for beatoraja themes.
//
// Mirrors `loadLr2ThemeSkinsFromFiles` from `@be-music/lr2-skin` so the host UI can keep its LR2 code path and pick
// up beatoraja themes through a parallel surface. The parser pipeline lives in `@be-music/beatoraja-skin`; this file
// only wires the dropped-File array up to that pipeline and doesn't open any PixiJS resources.

import { asLoadedBytes, discoverBeatorajaTheme, loadAssetBytes, readFilesIntoBytesMap } from '@be-music/beatoraja-skin';
import type {
  BeatorajaPlaySkinMap,
  BeatorajaPlayVariant,
  BeatorajaSkinConfig,
  BeatorajaSkinEntry,
  BeatorajaSkinFileEntry,
  BeatorajaSkinHeader,
  BeatorajaSkinInputFile,
  BeatorajaTheme,
  BeatorajaThemeDiscoveryWarning,
} from '@be-music/beatoraja-skin';
import type { LoadProgressCallback } from '../../collection/types.ts';

/** Single discovered skin entry, sized to live alongside its loaded byte map. */
export interface BeatorajaThemeBundle {
  /** All files the user dropped, indexed by case-insensitive lookup key. */
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>;
  /** Per-scene entries discovered from the bundle. */
  theme: BeatorajaTheme;
  /** Entries the discovery pass failed to parse. Surfaced for diagnostics; consumers can keep going. */
  warnings: ReadonlyArray<BeatorajaThemeDiscoveryWarning>;
}

export interface LoadBeatorajaThemeOptions {
  /**
   * Optional progress hook fired as files are read. The bundle parser is fast (<50ms for the reference theme), so the
   * dominant cost is reading file bytes off disk; the callback fires once per file as the read completes.
   */
  onProgress?: LoadProgressCallback;
}

/**
 * Read the dropped theme files into memory and discover every skin entry inside. Returns the
 * file map alongside the discovered theme so the caller can pass both to `loadBeatorajaSkin`
 * (from `@be-music/beatoraja-skin`) once the user picks a scene + variant.
 */
export async function loadBeatorajaThemeFromFiles(
  files: ReadonlyArray<BeatorajaSkinInputFile>,
  options: LoadBeatorajaThemeOptions = {},
): Promise<BeatorajaThemeBundle> {
  const total = files.length;
  const fileMap = await readFilesIntoBytesMap(files, {
    shouldDefer: shouldDeferBeatorajaThemeFile,
    onRead: (_path, current) => {
      options.onProgress?.({ phase: 'reading', current, total });
    },
  });
  const { theme, warnings } = discoverBeatorajaTheme(fileMap);
  return { files: fileMap, theme, warnings };
}

const EAGER_BEATORAJA_THEME_EXTENSIONS = [
  '.json',
  '.luaskin',
  '.lua',
  '.png',
  '.jpg',
  '.jpeg',
  '.bmp',
  '.gif',
  '.webp',
  '.tga',
  '.svg',
] as const;

function shouldDeferBeatorajaThemeFile(path: string): boolean {
  // Whole beatoraja folder drops often include JRE/runtime artifacts. Keep only skin scripts and
  // images eager; fonts/audio/other files are loaded on demand by their dedicated loaders.
  const lower = path.toLowerCase();
  return !EAGER_BEATORAJA_THEME_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Compact textual summary of the play skins inside a bundle. Useful for logging "loaded play=7,14" lines next to the
 * LR2 equivalent.
 */
export function summarizeBeatorajaPlaySkins(playSkins: BeatorajaPlaySkinMap, separator = ','): string {
  const variants: BeatorajaPlayVariant[] = ['7', '5', '14', '10', '9', '24', '24d'];
  const present = variants.filter((v) => playSkins[v] !== undefined);
  return present.join(separator);
}

/**
 * Play variants the renderer is willing to mount. The browser player only supports BMS / BMSON charts (5 / 7 / 9 /
 * 10 / 14 keys), so the 24-key variants beatoraja's reference theme ships are deliberately excluded — there's no
 * 24-key chart format the engine could feed in.
 *
 * If the dropped theme only ships a 24-key skin, the host should fall back to the LR2 theme for gameplay. This
 * matches how `pickLr2PlaySkin` chains through fallbacks for missing variants.
 */
const BEATORAJA_PLAYABLE_VARIANTS = ['7', '5', '9', '10', '14'] as const satisfies ReadonlyArray<BeatorajaPlayVariant>;
export type BeatorajaPlayableVariant = (typeof BEATORAJA_PLAYABLE_VARIANTS)[number];

/**
 * Map a chart's key count + double-play flag to the corresponding beatoraja play variant. Mirrors the logic
 * `pickLr2PlaySkin` uses on the LR2 side. Returns `undefined` for chart shapes the renderer doesn't support.
 */
export function pickBeatorajaPlayableVariant(chart: {
  keys: number;
  isDouble: boolean;
  isPms: boolean;
}): BeatorajaPlayableVariant | undefined {
  if (chart.isPms) return '9';
  if (chart.isDouble) {
    if (chart.keys === 14) return '14';
    if (chart.keys === 10) return '10';
    return undefined;
  }
  if (chart.keys === 7) return '7';
  if (chart.keys === 5) return '5';
  return undefined;
}

/**
 * Per-variant fallback chain limited to {@link BEATORAJA_PLAYABLE_VARIANTS}. When the user's theme doesn't
 * ship the desired variant (very common — many themes only author the 7-keys variant and let smaller charts
 * re-use it), this picks the closest playable substitute. Mirrors {@link pickBeatorajaPlaySkin}'s fallback
 * ordering but never returns the 24-key variants the engine can't drive.
 *
 * Returns `undefined` when the theme has no playable variant at all.
 */
const PLAYABLE_FALLBACKS: Record<BeatorajaPlayableVariant, ReadonlyArray<BeatorajaPlayableVariant>> = {
  '7': ['7', '14', '5', '10', '9'],
  '5': ['5', '7', '14', '10', '9'],
  '14': ['14', '7', '10', '5', '9'],
  '10': ['10', '14', '7', '5', '9'],
  '9': ['9', '7', '14', '5', '10'],
};

export function pickBeatorajaPlayableSkinVariant(
  playSkins: BeatorajaPlaySkinMap,
  desired: BeatorajaPlayableVariant,
): BeatorajaPlayableVariant | undefined {
  for (const v of PLAYABLE_FALLBACKS[desired]) {
    if (playSkins[v] !== undefined) return v;
  }
  return undefined;
}

export type {
  BeatorajaPlaySkinMap,
  BeatorajaPlayVariant,
  BeatorajaSkinConfig,
  BeatorajaSkinEntry,
  BeatorajaSkinHeader,
  BeatorajaTheme,
};

/** BGM byte arrays discovered inside a beatoraja theme bundle. Each slot is a decoded WAV / OGG / MP3
 * payload ready to hand to `AudioContext.decodeAudioData`. Slots are `undefined` when no matching
 * file exists in the dropped tree.
 */
export interface BeatorajaThemeBgm {
  /** Splash audio for the decide scene — typically `decide.wav` / `*decide*.wav`. */
  decide?: Uint8Array;
  /** Result-scene jingle for cleared runs — `clear.wav`. */
  clear?: Uint8Array;
  /** Result-scene jingle for failed runs — `fail.wav`. */
  fail?: Uint8Array;
  /** Generic result jingle — `result.wav`. Used when neither `clear` nor `fail` matched the outcome. */
  result?: Uint8Array;
}

const BGM_AUDIO_EXTENSIONS = ['.wav', '.ogg', '.mp3', '.flac'] as const;

/**
 * Scan a beatoraja theme bundle for BGM files. The lookup is heuristic — beatoraja's spec doesn't
 * pin BGM to a fixed path, so we search every entry in `bundle.files` for a basename matching one
 * of the conventional names (`decide`, `clear`, `fail`, `result`) followed by a recognized audio
 * extension. The first match wins per slot; subsequent matches are ignored.
 *
 * Returns synchronously when every matched entry was eagerly loaded. When some entries are
 * deferred (lazy file readers), the helper awaits each `loadAssetBytes` call serially — each BGM
 * is small enough (<1 MiB) that the latency is negligible, and serializing avoids spawning a
 * concurrent read storm on the dropped-file IO layer.
 */
export async function findBeatorajaThemeBgm(bundle: BeatorajaThemeBundle): Promise<BeatorajaThemeBgm> {
  // Track only the FIRST match per slot. The bundle is iterated in `Map` insertion order, which
  // gives a stable result on re-runs.
  const slots: Record<keyof BeatorajaThemeBgm, string | undefined> = {
    decide: undefined,
    clear: undefined,
    fail: undefined,
    result: undefined,
  };
  for (const path of bundle.files.keys()) {
    const lower = path.toLowerCase();
    if (!BGM_AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue;
    // Match on the file's basename — `sound/decide.wav` and `<theme-root>/decide.wav` and
    // `LR2files/Sound/<theme>/decide.wav` all count. Stricter matching (e.g. requiring a
    // `sound/` prefix) would miss themes that use unusual layouts.
    const slash = lower.lastIndexOf('/');
    const base = slash >= 0 ? lower.slice(slash + 1) : lower;
    // Strip the extension before comparing to the slot name. `decide.wav` → `decide`.
    const dot = base.lastIndexOf('.');
    const stem = dot >= 0 ? base.slice(0, dot) : base;
    // Match exact stem first (most precise), then fall back to substring match (`decide_v2`,
    // `clear_loop`, etc.). The exact match wins via the early `slots[k] === undefined` gate.
    for (const slot of ['decide', 'clear', 'fail', 'result'] as const) {
      if (slots[slot] !== undefined) continue;
      if (stem === slot || stem.includes(slot)) {
        slots[slot] = path;
        break;
      }
    }
  }
  const out: BeatorajaThemeBgm = {};
  for (const slot of ['decide', 'clear', 'fail', 'result'] as const) {
    const path = slots[slot];
    if (path === undefined) continue;
    const entry = bundle.files.get(path);
    const bytes = asLoadedBytes(entry) ?? (await loadAssetBytes(entry));
    if (bytes !== undefined) out[slot] = bytes;
  }
  return out;
}
