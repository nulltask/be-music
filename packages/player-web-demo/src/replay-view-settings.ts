import { DEFAULT_PLAYLOG_VIEW_REPLAY, type PlaylogViewReplay } from '@be-music/player/playlog';

/**
 * The Debug Menu's "Replay / ghost" settings: which of what a play log recorded the player seeing (tempo, hi-speed,
 * SUDDEN+ / HIDDEN+, LIFT) a replay or ghost reproduces, the rest staying the viewer's own. All on by default;
 * remembered in `localStorage` and read once per play, at its start.
 */

/** `localStorage` key of the replay view settings. */
export const REPLAY_VIEW_STORAGE_KEY = 'be-music-demo.replay-view';

const KEYS = ['tempo', 'hiSpeed', 'covers', 'lift'] as const satisfies readonly (keyof PlaylogViewReplay)[];

/** Stored settings, each toggle checked on its own; on (the default) for anything missing or unreadable. */
export function parseStoredReplayView(raw: string | null | undefined): PlaylogViewReplay {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw === null || raw === undefined ? undefined : JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) stored = parsed as Record<string, unknown>;
  } catch {
    // Unreadable: the defaults.
  }
  const settings = { ...DEFAULT_PLAYLOG_VIEW_REPLAY };
  for (const key of KEYS) {
    if (typeof stored[key] === 'boolean') settings[key] = stored[key];
  }
  return settings;
}

/** The remembered settings, or the defaults when none are stored or storage is blocked. */
export function readStoredReplayView(
  storage: Pick<Storage, 'getItem'> | undefined = defaultStorage(),
): PlaylogViewReplay {
  try {
    return parseStoredReplayView(storage?.getItem(REPLAY_VIEW_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_PLAYLOG_VIEW_REPLAY };
  }
}

/** Remembers the settings for the next visit. */
export function storeReplayView(
  settings: Readonly<PlaylogViewReplay>,
  storage: Pick<Storage, 'setItem'> | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(
      REPLAY_VIEW_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(KEYS.map((key) => [key, settings[key]]))),
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
