import { clamp } from '@be-music/shared-utils/core';
/**
 * The Debug Menu's play tempo settings: the tempo slider (-50 % .. +50 %), how a tempo change sounds (also for NONSTOP
 * FIT stages) and the keep-pitch stretcher. Remembered in `localStorage` and read once per play, at its start; with the
 * pitch following the tempo, the slider also changes the running play's tempo ({@link allowsLiveTempo}).
 */

/** `localStorage` key of the play tempo settings. */
export const PLAY_TEMPO_STORAGE_KEY = 'be-music.play-tempo';

/** The slider's range, in percent off the chart's own tempo. */
export const TEMPO_PERCENT_MIN = -50;
export const TEMPO_PERCENT_MAX = 50;

export interface PlayTempoSettings {
  /** Apply the stored tempo percentage; disabling preserves it for later. */
  tempoEnabled: boolean;
  /** The play tempo in percent off the chart's own: 0 plays it as written, -20 at 80 %. */
  tempoPercent: number;
  /**
   * How a tempo change sounds, for the song tempo and a NONSTOP FIT stage alike: `'pitch'` (the default, as LR2) plays
   * the sound faster or slower so the pitch moves too; `'keep-pitch'` stretches the sound and keeps its pitch.
   */
  tempoPitchMode: 'pitch' | 'keep-pitch';
  /** The time stretcher keep pitch uses: WSOLA (the default) or Signalsmith Stretch. */
  tempoStretchAlgorithm: 'signalsmith' | 'wsola';
}

export const DEFAULT_PLAY_TEMPO_SETTINGS: Readonly<PlayTempoSettings> = {
  tempoEnabled: false,
  tempoPercent: 0,
  tempoPitchMode: 'pitch',
  tempoStretchAlgorithm: 'wsola',
};

/** `value` as a whole percent within the slider's range; 0 when it is not a finite number. */
export function clampTempoPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.round(clamp(value, TEMPO_PERCENT_MIN, TEMPO_PERCENT_MAX));
}

/** The play tempo multiplier (`tempo` / `speed`) of a slider percent: -20 → 0.8. */
export function tempoFromPercent(percent: number): number {
  return (100 + clampTempoPercent(percent)) / 100;
}

/** The slider percent of a play tempo multiplier: 0.8 → -20. */
export function tempoPercentFromTempo(tempo: number): number {
  return clampTempoPercent(Math.round((tempo - 1) * 100));
}

/**
 * Whether the tempo slider changes a running play's tempo live: only when the pitch follows the tempo (kept pitch
 * stretched the samples to the tempo they loaded at), for a play the player drives (not a replay, which follows its
 * log), at the slider's tempo (not a course stage the course turned the tempo off for).
 */
export function allowsLiveTempo(
  settings: Pick<PlayTempoSettings, 'tempoEnabled' | 'tempoPercent' | 'tempoPitchMode'>,
  play: { replay: boolean; tempo: number },
): boolean {
  return (
    settings.tempoEnabled &&
    settings.tempoPitchMode === 'pitch' &&
    !play.replay &&
    play.tempo === tempoFromPercent(settings.tempoPercent)
  );
}

/** The tempo for a status line (`tempo -20%`, `tempo +5%`), or `undefined` at the chart's own tempo. */
export function describeTempo(percent: number): string | undefined {
  const clamped = clampTempoPercent(percent);
  if (clamped === 0) return undefined;
  return `tempo ${clamped > 0 ? '+' : ''}${clamped}%`;
}

/**
 * The status line of a play starting: `Playing: <title>`, with the notes in parentheses (`Playing (beatoraja, tempo
 * -20%): <title>`).
 */
export function describePlayingStatus(
  title: string,
  options: { family?: string; tempoPercent?: number; replay?: boolean } = {},
): string {
  const notes = [options.family, describeTempo(options.tempoPercent ?? 0)].filter((note) => note !== undefined);
  return `${options.replay === true ? 'Replaying' : 'Playing'}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}: ${title}`;
}

/** Stored settings, each field checked on its own; the defaults for anything missing or unreadable. */
export function parseStoredPlayTempoSettings(raw: string | null | undefined): PlayTempoSettings {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw === null || raw === undefined ? undefined : JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) stored = parsed as Record<string, unknown>;
  } catch {
    // Unreadable: the defaults.
  }
  return {
    tempoEnabled: stored.tempoEnabled === true,
    tempoPercent: clampTempoPercent(stored.tempoPercent),
    tempoPitchMode: stored.tempoPitchMode === 'keep-pitch' ? 'keep-pitch' : 'pitch',
    tempoStretchAlgorithm: stored.tempoStretchAlgorithm === 'signalsmith' ? 'signalsmith' : 'wsola',
  };
}

/** The remembered settings, or the defaults when none are stored or storage is blocked. */
export function readStoredPlayTempoSettings(
  storage: Pick<Storage, 'getItem'> | undefined = defaultStorage(),
): PlayTempoSettings {
  try {
    return parseStoredPlayTempoSettings(storage?.getItem(PLAY_TEMPO_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_PLAY_TEMPO_SETTINGS };
  }
}

/** Remembers the settings for the next visit. */
export function storePlayTempoSettings(
  settings: PlayTempoSettings,
  storage: Pick<Storage, 'setItem'> | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(
      PLAY_TEMPO_STORAGE_KEY,
      JSON.stringify({
        tempoEnabled: settings.tempoEnabled,
        tempoPercent: clampTempoPercent(settings.tempoPercent),
        tempoPitchMode: settings.tempoPitchMode,
        tempoStretchAlgorithm: settings.tempoStretchAlgorithm,
      }),
    );
  } catch {
    // Private windows / blocked storage: the settings still apply for this session.
  }
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
