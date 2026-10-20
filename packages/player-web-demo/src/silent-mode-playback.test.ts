import { describe, expect, it } from 'vite-plus/test';
import {
  AUDIO_UNLOCK_EVENTS,
  PLAY_IN_SILENT_MODE_STORAGE_KEY,
  SILENT_MODE_HINT_SEEN_STORAGE_KEY,
  SILENT_MODE_STRINGS,
  installSilentModePlayback,
  parseStoredPlayInSilentMode,
  readPlayInSilentMode,
  readSilentModeHintSeen,
  resolveSilentModeLanguage,
  serializePlayInSilentMode,
  shouldShowSilentModeHint,
  storePlayInSilentMode,
  storeSilentModeHintSeen,
  type SettingStorage,
} from './silent-mode-playback.ts';

function memoryStorage(): SettingStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const BLOCKED_STORAGE: SettingStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('play-in-silent-mode persistence', () => {
  it('defaults to on', () => {
    expect(parseStoredPlayInSilentMode(null)).toBe(true);
    expect(parseStoredPlayInSilentMode(undefined)).toBe(true);
    expect(parseStoredPlayInSilentMode('true')).toBe(true);
    expect(parseStoredPlayInSilentMode('')).toBe(true);
    expect(readPlayInSilentMode(memoryStorage())).toBe(true);
  });

  it('turns off only for a stored off', () => {
    expect(parseStoredPlayInSilentMode('off')).toBe(false);
    expect(parseStoredPlayInSilentMode('on')).toBe(true);
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    storePlayInSilentMode(true, storage);
    expect(storage.values.get(PLAY_IN_SILENT_MODE_STORAGE_KEY)).toBe('on');
    expect(readPlayInSilentMode(storage)).toBe(true);
    storePlayInSilentMode(false, storage);
    expect(storage.values.get(PLAY_IN_SILENT_MODE_STORAGE_KEY)).toBe(serializePlayInSilentMode(false));
    expect(readPlayInSilentMode(storage)).toBe(false);
  });

  it('survives blocked storage', () => {
    expect(readPlayInSilentMode(BLOCKED_STORAGE)).toBe(true);
    expect(() => storePlayInSilentMode(false, BLOCKED_STORAGE)).not.toThrow();
    expect(readPlayInSilentMode(undefined)).toBe(true);
  });

  it('remembers that the hint was shown', () => {
    const storage = memoryStorage();
    expect(readSilentModeHintSeen(storage)).toBe(false);
    storeSilentModeHintSeen(storage);
    expect(storage.values.get(SILENT_MODE_HINT_SEEN_STORAGE_KEY)).toBe('1');
    expect(readSilentModeHintSeen(storage)).toBe(true);
  });

  it('treats unreadable storage as hint seen, so it never nags on every visit', () => {
    expect(readSilentModeHintSeen(BLOCKED_STORAGE)).toBe(true);
    expect(() => storeSilentModeHintSeen(BLOCKED_STORAGE)).not.toThrow();
  });
});

describe('shouldShowSilentModeHint', () => {
  const base = { supported: true, enabled: false, seen: false, touchFirst: true };

  it('shows once on a supported touch device with the setting off', () => {
    expect(shouldShowSilentModeHint(base)).toBe(true);
  });

  it.each([
    ['unsupported browser', { supported: false }],
    ['setting already on', { enabled: true }],
    ['already seen', { seen: true }],
    ['desktop', { touchFirst: false }],
  ])('stays hidden: %s', (_label, change) => {
    expect(shouldShowSilentModeHint({ ...base, ...change })).toBe(false);
  });
});

describe('resolveSilentModeLanguage', () => {
  it('picks Japanese for ja locales, English otherwise', () => {
    expect(resolveSilentModeLanguage('ja')).toBe('ja');
    expect(resolveSilentModeLanguage('ja-JP')).toBe('ja');
    expect(resolveSilentModeLanguage('en-US')).toBe('en');
    expect(resolveSilentModeLanguage(undefined)).toBe('en');
  });

  it('mentions that other apps pause in both languages', () => {
    expect(SILENT_MODE_STRINGS.en.note).toMatch(/other apps/);
    expect(SILENT_MODE_STRINGS.ja.note).toMatch(/他のアプリ/);
  });
});

describe('installSilentModePlayback', () => {
  function setup(enabled: { value: boolean }) {
    const session = { type: 'auto' };
    const target = new EventTarget();
    const visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    let firstGestures = 0;
    const dispose = installSilentModePlayback({
      enabled: () => enabled.value,
      target,
      visibility,
      host: { audioSession: session },
      onFirstGesture: () => {
        firstGestures += 1;
      },
    });
    return { session, target, visibility, dispose, firstGestures: () => firstGestures };
  }

  it('applies the setting immediately, before any audio exists', () => {
    expect(setup({ value: true }).session.type).toBe('playback');
    expect(setup({ value: false }).session.type).toBe('auto');
  });

  it('asks for playback when nothing is stored', () => {
    const session = { type: 'auto' };
    installSilentModePlayback({
      enabled: () => readPlayInSilentMode(memoryStorage()),
      target: new EventTarget(),
      host: { audioSession: session },
    });
    expect(session.type).toBe('playback');
  });

  it('re-applies on the first gesture only, then reports it once', () => {
    const enabled = { value: false };
    const { session, target, firstGestures } = setup(enabled);
    enabled.value = true;
    target.dispatchEvent(new Event(AUDIO_UNLOCK_EVENTS[0]!));
    expect(session.type).toBe('playback');
    expect(firstGestures()).toBe(1);
    session.type = 'ambient';
    for (const type of AUDIO_UNLOCK_EVENTS) target.dispatchEvent(new Event(type));
    expect(session.type).toBe('ambient');
    expect(firstGestures()).toBe(1);
  });

  it('re-applies when the page becomes visible again or is restored', () => {
    const { session, target, visibility } = setup({ value: true });
    session.type = 'auto';
    visibility.visibilityState = 'hidden';
    visibility.dispatchEvent(new Event('visibilitychange'));
    expect(session.type).toBe('auto');
    visibility.visibilityState = 'visible';
    visibility.dispatchEvent(new Event('visibilitychange'));
    expect(session.type).toBe('playback');
    session.type = 'auto';
    target.dispatchEvent(new Event('pageshow'));
    expect(session.type).toBe('playback');
  });

  it('stops listening once disposed', () => {
    const { session, target, visibility, dispose, firstGestures } = setup({ value: true });
    dispose();
    session.type = 'auto';
    target.dispatchEvent(new Event('pointerdown'));
    target.dispatchEvent(new Event('pageshow'));
    visibility.dispatchEvent(new Event('visibilitychange'));
    expect(session.type).toBe('auto');
    expect(firstGestures()).toBe(0);
  });

  it('is a no-op without an audio session', () => {
    const target = new EventTarget();
    expect(() => {
      installSilentModePlayback({ enabled: () => true, target, host: {} });
      target.dispatchEvent(new Event('pointerdown'));
    }).not.toThrow();
  });
});
