// Discovery helper for beatoraja system-sound paths.
//
// Beatoraja's reference engine reads system-sound paths from `config.json` keys (`sound_cursor`,
// `sound_select`, `sound_cancel`, `sound_folder`), which point at theme-relative bundle paths
// (typically inside `sound/` or `Sound/`). The web port doesn't load `config.json`, so the
// closest equivalent is to PROBE the bundle's file map for filenames matching the well-known
// conventions and pass any that match through to {@link PixiBeatorajaSelectScene}.
//
// Probe order per slot prefers the most specific / canonical name first, falls back to common
// alternatives skin authors use. Case-insensitive lookup; the file map's casing is preserved
// in the returned path so subsequent {@link BeatorajaSkinAudio.play} calls hit the same cache
// key as direct Lua-driven plays.

import { findCaseInsensitivePath, type BeatorajaSkinFileEntry } from '@be-music/beatoraja-skin';
import type { BeatorajaSelectSystemSoundPaths } from '../../scene/beatoraja/select.ts';

/**
 * Candidate filenames per slot. Listed in priority order — the first match wins. All are
 * relative to the theme bundle root; the LR2-derived `LR2files/Sound/lr2/*.wav` convention
 * is included as a fallback for themes that pack LR2-compatible sounds in that subdirectory.
 *
 * Beatoraja's own reference theme typically ships:
 *   - `sound/cursor.wav` (or `scratch.wav` in IIDX-derived themes)
 *   - `sound/decide.wav` / `select.wav`
 *   - `sound/cancel.wav` / `back.wav`
 *   - `sound/folder_open.wav` / `f-open.wav`
 *   - `sound/folder_close.wav` / `f-close.wav`
 *   - `sound/option.wav` / `o-change.wav`
 */
const CANDIDATE_PATHS: Record<keyof BeatorajaSelectSystemSoundPaths, ReadonlyArray<string>> = {
  cursor: [
    'sound/cursor.wav',
    'sound/cursor.ogg',
    'sound/scratch.wav',
    'sound/scratch.ogg',
    'sound/move.wav',
    'sound/move.ogg',
    'LR2files/Sound/lr2/scratch.wav',
  ],
  decide: [
    'sound/decide.wav',
    'sound/decide.ogg',
    'sound/select.wav',
    'sound/select.ogg',
    'sound/start.wav',
    'sound/start.ogg',
    'LR2files/Bgm/_common/decide.wav',
  ],
  cancel: ['sound/cancel.wav', 'sound/cancel.ogg', 'sound/back.wav', 'sound/back.ogg', 'LR2files/Sound/lr2/back.wav'],
  folderOpen: [
    'sound/folder_open.wav',
    'sound/folder_open.ogg',
    'sound/f-open.wav',
    'sound/f-open.ogg',
    'sound/open.wav',
    'sound/open.ogg',
    'LR2files/Sound/lr2/f-open.wav',
  ],
  folderClose: [
    'sound/folder_close.wav',
    'sound/folder_close.ogg',
    'sound/f-close.wav',
    'sound/f-close.ogg',
    'sound/close.wav',
    'sound/close.ogg',
    'LR2files/Sound/lr2/f-close.wav',
  ],
  optionChange: [
    'sound/option.wav',
    'sound/option.ogg',
    'sound/o-change.wav',
    'sound/o-change.ogg',
    'sound/change.wav',
    'sound/change.ogg',
    'LR2files/Sound/lr2/o-change.wav',
  ],
};

/**
 * Walk {@link CANDIDATE_PATHS} for each slot against the theme bundle's file map; return a
 * partial mapping with the matching paths. Slots without a hit stay undefined and the scene
 * stays silent for those events. The returned record can be passed straight to
 * {@link PixiBeatorajaSelectSceneOptions.systemSoundPaths}.
 *
 * Returns an empty object (no slots) when the bundle has no `sound/` directory at all — e.g.
 * a stripped LR2 theme dropped in. Hosts that want to know whether sounds were discovered can
 * count keys on the result.
 */
export function discoverBeatorajaSystemSoundPaths(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
): BeatorajaSelectSystemSoundPaths {
  const out: { -readonly [K in keyof BeatorajaSelectSystemSoundPaths]: string | undefined } = {};
  (Object.keys(CANDIDATE_PATHS) as Array<keyof BeatorajaSelectSystemSoundPaths>).forEach((slot) => {
    const candidates = CANDIDATE_PATHS[slot];
    for (const candidate of candidates) {
      const resolved = findCaseInsensitivePath(files, candidate);
      if (resolved !== undefined) {
        out[slot] = resolved;
        break;
      }
    }
  });
  return out;
}

/**
 * Looping select-scene BGM discovery — a sibling to {@link discoverBeatorajaSystemSoundPaths}
 * but for the long-form background music that plays under the song-select chrome.
 *
 * Beatoraja's reference engine stores this as `bgm_select` in `config.json`; the web port
 * doesn't load that config so we probe well-known paths instead. The candidate list covers:
 *
 *   - `Bgm/select.*` — beatoraja's typical theme layout (`<theme>/Bgm/select.wav`)
 *   - `bgm/select.*` — lowercase variants
 *   - `sound/select.*` — themes that lump BGM in with system cues (rare)
 *   - `LR2files/Bgm/_common/select.wav` — LR2-derived themes
 *
 * Returns the first matching bundle path, or `undefined` when no candidate exists. The
 * returned path is meant to flow into {@link PixiBeatorajaSelectSceneOptions.selectBgmPath}
 * and play through {@link BeatorajaSkinAudio.loop} — same audio backend the navigation cues
 * and Lua audio_play / audio_loop calls go through, so a single AudioContext serves them all.
 */
export function discoverBeatorajaSelectBgmPath(files: ReadonlyMap<string, BeatorajaSkinFileEntry>): string | undefined {
  const candidates = [
    'Bgm/select.wav',
    'Bgm/select.ogg',
    'Bgm/select.mp3',
    'bgm/select.wav',
    'bgm/select.ogg',
    'bgm/select.mp3',
    'sound/select_loop.wav',
    'sound/select_loop.ogg',
    'sound/bgm_select.wav',
    'sound/bgm_select.ogg',
    'LR2files/Bgm/_common/select.wav',
  ];
  for (const candidate of candidates) {
    const resolved = findCaseInsensitivePath(files, candidate);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}
