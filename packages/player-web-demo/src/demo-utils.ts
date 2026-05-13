import type { BeatorajaPlayableVariant } from '@be-music/player-web/skin';
import type { LoadProgress } from '@be-music/player-web/collection';
import { BEATORAJA_SKIN_TYPE } from '@be-music/beatoraja-skin';

/**
 * Human-readable labels shown alongside the loading-overlay progress bar. Keyed by the `LoadProgressPhase`
 * discriminator the `player-web` loaders emit. The web UI is English-only, so these strings stay in English even though
 * the surrounding project conversation is in Japanese.
 */
export const phaseLabels: Record<LoadProgress['phase'], string> = {
  enumerating: 'Collecting files…',
  reading: 'Reading files…',
  parsing: 'Parsing charts…',
  theme: 'Loading LR2 theme…',
};

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
  }
}
