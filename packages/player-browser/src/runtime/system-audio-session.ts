/**
 * The platform audio session (`navigator.audioSession`, W3C Audio Session API): how the page's audio mixes with other
 * apps and whether it obeys the device's silent mode. Not to be confused with the engine's internal
 * `WebAudioSession` (`web-audio-session.ts`), which drives the player's Web Audio graph.
 *
 * Safari / WebKit (iOS 17+, macOS) implements it. With the default `'auto'` type, Web Audio counts as ambient sound
 * on iOS: it mixes with music from other apps and the Ring / Silent switch mutes it. `'playback'` makes it audible in
 * silent mode, at the cost of pausing other apps' audio. Browsers without the API leave every helper here a no-op.
 *
 * @see https://w3c.github.io/audio-session/
 */

/** The audio session types the W3C Audio Session draft defines. */
export type SystemAudioSessionType =
  | 'auto'
  | 'playback'
  | 'transient'
  | 'transient-solo'
  | 'ambient'
  | 'play-and-record';

/** The part of an `AudioSession` these helpers use. */
export interface SystemAudioSessionLike {
  type: string;
}

/** Where to look for the audio session: `navigator`, or a stand-in with the same shape. */
export interface SystemAudioSessionHost {
  readonly audioSession?: SystemAudioSessionLike | null;
}

function defaultHost(): SystemAudioSessionHost | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as SystemAudioSessionHost);
}

/** The host's audio session, or `undefined` when the browser has none (or reading it throws). */
export function getSystemAudioSession(
  host: SystemAudioSessionHost | undefined = defaultHost(),
): SystemAudioSessionLike | undefined {
  try {
    const session = host?.audioSession;
    return typeof session === 'object' && session !== null && 'type' in session ? session : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the browser exposes an audio session whose type a page can set. */
export function supportsSystemAudioSession(host: SystemAudioSessionHost | undefined = defaultHost()): boolean {
  return getSystemAudioSession(host) !== undefined;
}

/**
 * Sets the audio session type. Returns whether the session now reports `type`: `false` when the browser has no audio
 * session, rejects the value, or throws. Setting the type it already has is skipped (and returns `true`).
 */
export function applySystemAudioSessionType(
  type: SystemAudioSessionType,
  host: SystemAudioSessionHost | undefined = defaultHost(),
): boolean {
  const session = getSystemAudioSession(host);
  if (!session) return false;
  try {
    if (session.type !== type) session.type = type;
    return session.type === type;
  } catch {
    return false;
  }
}

/**
 * The audio session type for the "play sound in silent mode" choice: `'playback'` when on (audible with the silent
 * switch on, pauses other apps' audio), `'auto'` when off — the browser default, which keeps Web Audio ambient (mixes
 * with other apps, obeys the silent switch) and still lets a media element pick its own type.
 */
export function resolveSilentModeAudioSessionType(playInSilentMode: boolean): SystemAudioSessionType {
  return playInSilentMode ? 'playback' : 'auto';
}

/**
 * Applies the "play sound in silent mode" choice to the audio session. Call it before audio starts (before the first
 * `AudioContext` is created or resumed) and again from the user gesture that unlocks audio, so the type is in place
 * whenever the platform activates the session. Returns whether it applied; a no-op returning `false` without the API.
 */
export function applySilentModePlayback(
  playInSilentMode: boolean,
  host: SystemAudioSessionHost | undefined = defaultHost(),
): boolean {
  return applySystemAudioSessionType(resolveSilentModeAudioSessionType(playInSilentMode), host);
}
