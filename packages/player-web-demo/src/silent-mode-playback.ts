// The demo's "Play in silent mode" setting: whether the page asks the platform audio session (`navigator.audioSession`,
// Safari / iOS) for `'playback'`, so sound plays with the Ring / Silent switch on — at the cost of pausing music
// playing in other apps. On by default (a rhythm game with no sound is unplayable); turned off it restores the
// browser's own `'auto'`. Offered on the start card and in the Debug Menu. Also the one-time hint pointing iPhone /
// iPad users at the setting when sound starts with it off.

import { applySilentModePlayback, type SystemAudioSessionHost } from '@be-music/player-web/audio';

export const PLAY_IN_SILENT_MODE_STORAGE_KEY = 'be-music-demo.play-in-silent-mode';
export const SILENT_MODE_HINT_SEEN_STORAGE_KEY = 'be-music-demo.silent-mode-hint-seen';

/** Parses the stored setting: only `'off'` turns it off, anything else (nothing stored, junk) keeps the default on. */
export function parseStoredPlayInSilentMode(raw: string | null | undefined): boolean {
  return raw !== 'off';
}

export function serializePlayInSilentMode(enabled: boolean): string {
  return enabled ? 'on' : 'off';
}

/** Storage the demo reads settings from: `localStorage`, or a stand-in in tests. */
export type SettingStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): SettingStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored setting; on when nothing is stored or storage is blocked. */
export function readPlayInSilentMode(storage: SettingStorage | undefined = defaultStorage()): boolean {
  try {
    return parseStoredPlayInSilentMode(storage?.getItem(PLAY_IN_SILENT_MODE_STORAGE_KEY));
  } catch {
    return true;
  }
}

export function storePlayInSilentMode(enabled: boolean, storage: SettingStorage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(PLAY_IN_SILENT_MODE_STORAGE_KEY, serializePlayInSilentMode(enabled));
  } catch {
    // Private windows / blocked storage: the choice still applies for this session.
  }
}

export function readSilentModeHintSeen(storage: SettingStorage | undefined = defaultStorage()): boolean {
  try {
    return storage?.getItem(SILENT_MODE_HINT_SEEN_STORAGE_KEY) === '1';
  } catch {
    // Unreadable storage: treat as seen, so a blocked store never shows the hint on every visit.
    return true;
  }
}

export function storeSilentModeHintSeen(storage: SettingStorage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(SILENT_MODE_HINT_SEEN_STORAGE_KEY, '1');
  } catch {
    // Blocked storage: the hint stays hidden for this session anyway.
  }
}

/** What decides whether the "No sound?" hint shows when sound first starts. */
export interface SilentModeHintInput {
  /** The browser has an audio session (Safari / iOS); elsewhere the setting does not exist. */
  readonly supported: boolean;
  /** The setting is already on. */
  readonly enabled: boolean;
  /** The hint was shown before (once per browser). */
  readonly seen: boolean;
  /** A phone or tablet — only those have a silent switch that mutes web audio. */
  readonly touchFirst: boolean;
}

/** Show the hint once, on a touch-first device whose browser supports the setting, while the setting is off. */
export function shouldShowSilentModeHint(input: SilentModeHintInput): boolean {
  return input.supported && input.touchFirst && !input.enabled && !input.seen;
}

export type SilentModeLanguage = 'en' | 'ja';

/** The UI language for the setting and hint: Japanese when the browser prefers it, else English. */
export function resolveSilentModeLanguage(language: string | undefined): SilentModeLanguage {
  return language?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export interface SilentModeStrings {
  readonly label: string;
  readonly note: string;
  readonly hint: string;
  readonly hintAction: string;
  readonly hintDismiss: string;
}

export const SILENT_MODE_STRINGS: Readonly<Record<SilentModeLanguage, SilentModeStrings>> = {
  en: {
    label: 'Play in silent mode',
    note: 'Plays sound even when the iPhone / iPad is in silent mode. Pauses music playing in other apps.',
    hint: 'No sound? Your device may be in silent mode.',
    hintAction: 'Play in silent mode',
    hintDismiss: 'Dismiss',
  },
  ja: {
    label: '消音モードでも再生',
    note: 'iPhone / iPad が消音モードでも音を鳴らします。他のアプリで再生中の音楽は停止します。',
    hint: '音が出ない場合は、消音モードになっているかもしれません。',
    hintAction: '消音モードでも再生',
    hintDismiss: '閉じる',
  },
};

/** The page events {@link installSilentModePlayback} listens to. */
export interface SilentModeEventTarget {
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: () => void, options?: EventListenerOptions): void;
}

export interface InstallSilentModePlaybackOptions {
  /** The current setting. */
  readonly enabled: () => boolean;
  /** Where the user gestures and `pageshow` land (`window`). */
  readonly target: SilentModeEventTarget;
  /** Where `visibilitychange` lands (`document`), and whether the page is visible. */
  readonly visibility?: SilentModeEventTarget & { readonly visibilityState?: DocumentVisibilityState };
  /** The `navigator` (or a stand-in) holding the audio session. */
  readonly host?: SystemAudioSessionHost;
  /** Called once, on the first user gesture — the moment browsers let audio start. */
  readonly onFirstGesture?: () => void;
}

/** The user gestures that unlock audio in the browser (the scenes resume their `AudioContext` from these). */
export const AUDIO_UNLOCK_EVENTS: readonly string[] = ['pointerdown', 'keydown', 'touchend'];

/**
 * Applies the setting now (before any `AudioContext` exists) and again whenever the platform may activate the audio
 * session afresh: the first user gesture (when the scenes resume their contexts), returning to the page, and a page
 * restored from the back/forward cache. Returns a function that removes the listeners.
 */
export function installSilentModePlayback(options: InstallSilentModePlaybackOptions): () => void {
  const { target, visibility, host } = options;
  const apply = () => {
    applySilentModePlayback(options.enabled(), host);
  };
  apply();
  // Capture phase, so the type is set before a scene's own handler resumes its context on the same gesture.
  const listenerOptions: AddEventListenerOptions = { capture: true };
  const onGesture = () => {
    apply();
    for (const type of AUDIO_UNLOCK_EVENTS) target.removeEventListener(type, onGesture, listenerOptions);
    options.onFirstGesture?.();
  };
  for (const type of AUDIO_UNLOCK_EVENTS) target.addEventListener(type, onGesture, listenerOptions);
  const onVisibilityChange = () => {
    if (visibility?.visibilityState !== 'hidden') apply();
  };
  visibility?.addEventListener('visibilitychange', onVisibilityChange);
  target.addEventListener('pageshow', apply);
  return () => {
    for (const type of AUDIO_UNLOCK_EVENTS) target.removeEventListener(type, onGesture, listenerOptions);
    visibility?.removeEventListener('visibilitychange', onVisibilityChange);
    target.removeEventListener('pageshow', apply);
  };
}

export interface StartSilentModeOptionOptions {
  /** The start card's `#start-silent-mode` section, hidden in the markup until the browser offers the setting. */
  readonly section: HTMLElement;
  readonly strings: SilentModeStrings;
  /** The current setting. */
  readonly checked: boolean;
  /** The player ticked or unticked the box. */
  readonly onChange: (checked: boolean) => void;
}

/** The start card's "Play in silent mode" checkbox, kept in step with the Debug Menu's. */
export interface StartSilentModeOption {
  setChecked(checked: boolean): void;
}

/**
 * Fills and shows the start card's "Play in silent mode" row: the checkbox and a one-line note on what it costs. Call
 * it only where the browser has an audio session; elsewhere the section stays hidden.
 */
export function mountStartSilentModeOption(options: StartSilentModeOptionOptions): StartSilentModeOption | undefined {
  const { section, strings } = options;
  const input = section.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (input === null) return undefined;
  const label = section.querySelector<HTMLElement>('[data-silent-mode-label]');
  const note = section.querySelector<HTMLElement>('[data-silent-mode-note]');
  if (label !== null) label.textContent = strings.label;
  if (note !== null) note.textContent = strings.note;
  input.checked = options.checked;
  input.addEventListener('change', () => options.onChange(input.checked));
  section.hidden = false;
  return {
    setChecked: (checked) => {
      input.checked = checked;
    },
  };
}

/** How long the hint stays up before it fades out by itself. */
export const SILENT_MODE_HINT_DURATION_MS = 9000;

export interface SilentModeHintOptions {
  readonly strings: SilentModeStrings;
  /** Turns the setting on (the hint's action button). */
  readonly onEnable: () => void;
  readonly parent?: HTMLElement;
}

/**
 * Shows the "No sound?" hint: a small card at the bottom of the screen with a button that turns the setting on and a
 * dismiss button. It never blocks the stage and leaves by itself after {@link SILENT_MODE_HINT_DURATION_MS}.
 */
export function mountSilentModeHint(options: SilentModeHintOptions): void {
  const { strings } = options;
  const card = document.createElement('div');
  card.className = 'silent-mode-hint';
  card.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.className = 'silent-mode-hint-text';
  text.textContent = strings.hint;
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'silent-mode-hint-action';
  action.textContent = strings.hintAction;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'silent-mode-hint-dismiss';
  dismiss.setAttribute('aria-label', strings.hintDismiss);
  dismiss.textContent = '×';
  card.append(text, action, dismiss);
  let timer = 0;
  const close = () => {
    window.clearTimeout(timer);
    card.remove();
  };
  // Taps on the card are not lane presses or scene clicks.
  card.addEventListener('pointerdown', (event) => event.stopPropagation());
  action.addEventListener('click', () => {
    options.onEnable();
    close();
  });
  dismiss.addEventListener('click', close);
  timer = window.setTimeout(close, SILENT_MODE_HINT_DURATION_MS);
  (options.parent ?? document.body).append(card);
}
