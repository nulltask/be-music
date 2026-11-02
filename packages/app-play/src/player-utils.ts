import type { BeatorajaPlayableVariant } from '@be-music/player-browser/skin';
import type { LoadProgress } from '@be-music/player-browser/collection';
import { BEATORAJA_SKIN_TYPE } from '@be-music/skin-beatoraja';
import { playerText } from './player-copy.ts';

/**
 * Human-readable labels shown alongside the loading-overlay progress bar, in the player's language.
 * Keyed by the `LoadProgressPhase` discriminator the loaders emit.
 */
export function phaseLabels(): Record<LoadProgress['phase'], string> {
  return playerText().phases;
}

/**
 * Produces a filesystem-safe base for the auto-downloaded recording filename. Strips characters that browsers / OSes
 * reject (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`), collapses runs of whitespace into single spaces, and trims the
 * result to a sensible cap so an absurdly long song title doesn't produce a path the OS rejects on save.
 */
export function sanitizeFilenameStem(input: string): string {
  return input
    .replace(/[/\\:*?"<>|]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80);
}

/** Map a playable variant to the matching `BEATORAJA_SKIN_TYPE` code. */
export function playSkinTypeForVariant(variant: BeatorajaPlayableVariant): number {
  switch (variant) {
    case '7':
      return BEATORAJA_SKIN_TYPE.PLAY_7KEYS;
    case '5':
      return BEATORAJA_SKIN_TYPE.PLAY_5KEYS;
    case '14':
      return BEATORAJA_SKIN_TYPE.PLAY_14KEYS;
    case '10':
      return BEATORAJA_SKIN_TYPE.PLAY_10KEYS;
    case '9':
      return BEATORAJA_SKIN_TYPE.PLAY_9KEYS;
    case '24':
      return BEATORAJA_SKIN_TYPE.PLAY_24KEYS;
    case '24d':
      return BEATORAJA_SKIN_TYPE.PLAY_24KEYS_DOUBLE;
  }
}
