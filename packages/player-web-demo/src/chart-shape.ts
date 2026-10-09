import {
  pickBeatorajaPlayableSkinVariant,
  pickBeatorajaPlayableVariant,
  type BeatorajaPlayableVariant,
  type BeatorajaThemeBundle,
} from '@be-music/player-web/skin';
import { resolveChartPlayVariant, type BrowserSongEntry } from '@be-music/player-web/collection';

/**
 * Maps a song's parsed chart variant onto the `{ keys, isDouble, isPms }` shape `pickBeatorajaPlayableVariant`
 * expects. Pure derivation — no state, no side effects.
 */
export function chartShapeFor(song: BrowserSongEntry): { keys: number; isDouble: boolean; isPms: boolean } {
  const variant = resolveChartPlayVariant(song);
  // `'48'` is the DP form of the 24-key keyboard mode, so it reports 24 keys per side plus `isDouble` — the same
  // per-side convention the IIDX `'14'` / `'10'` variants use.
  const keys =
    variant === '24' || variant === '48'
      ? 24
      : variant === '14'
        ? 14
        : variant === '10'
          ? 10
          : variant === '7'
            ? 7
            : variant === '5'
              ? 5
              : 9;
  return {
    keys,
    isDouble: variant === '14' || variant === '10' || variant === '48',
    isPms: variant === '9',
  };
}

/**
 * Resolves the actual skin variant the beatoraja gameplay path will mount for a chart. Returns the
 * desired variant verbatim when the theme ships it, the closest playable fallback otherwise, or
 * `undefined` when the theme has nothing playable.
 */
export function resolveBeatorajaSkinVariant(
  bundle: BeatorajaThemeBundle | undefined,
  song: BrowserSongEntry,
): BeatorajaPlayableVariant | undefined {
  if (!bundle) return undefined;
  const desired = pickBeatorajaPlayableVariant(chartShapeFor(song));
  if (desired === undefined) return undefined;
  return pickBeatorajaPlayableSkinVariant(bundle.theme.playSkins, desired);
}

/**
 * Quick predicate — `true` when the loaded beatoraja theme can render this song's gameplay scene. Threads through
 * {@link resolveBeatorajaSkinVariant} so the answer matches what the play path would actually mount.
 */
export function canPlaySongBeatoraja(bundle: BeatorajaThemeBundle | undefined, song: BrowserSongEntry): boolean {
  return resolveBeatorajaSkinVariant(bundle, song) !== undefined;
}
