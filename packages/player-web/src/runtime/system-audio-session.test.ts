import { describe, expect, it } from 'vite-plus/test';
import {
  applySilentModePlayback,
  applySystemAudioSessionType,
  getSystemAudioSession,
  resolveSilentModeAudioSessionType,
  supportsSystemAudioSession,
  type SystemAudioSessionHost,
} from './system-audio-session.ts';

/** A `navigator` stand-in whose audio session only accepts the W3C types, like WebKit's enum attribute. */
function makeHost(initial = 'auto'): { host: SystemAudioSessionHost; writes: string[] } {
  const writes: string[] = [];
  let type = initial;
  const valid = new Set(['auto', 'playback', 'transient', 'transient-solo', 'ambient', 'play-and-record']);
  const audioSession = {
    get type() {
      return type;
    },
    set type(value: string) {
      writes.push(value);
      // An invalid enum value is ignored, as WebIDL does for enumerated attributes.
      if (valid.has(value)) type = value;
    },
  };
  return { host: { audioSession }, writes };
}

describe('getSystemAudioSession / supportsSystemAudioSession', () => {
  it('finds the audio session on a host that has one', () => {
    const { host } = makeHost();
    expect(getSystemAudioSession(host)).toBe(host.audioSession);
    expect(supportsSystemAudioSession(host)).toBe(true);
  });

  it('reports no session when the host lacks it, has a null one, or is missing', () => {
    expect(supportsSystemAudioSession({})).toBe(false);
    expect(supportsSystemAudioSession({ audioSession: null })).toBe(false);
    expect(supportsSystemAudioSession(undefined)).toBe(false);
  });

  it('reports no session when reading it throws', () => {
    const host = {
      get audioSession(): never {
        throw new Error('blocked');
      },
    };
    expect(getSystemAudioSession(host)).toBeUndefined();
  });

  it('reads the global navigator by default (Node has no audio session)', () => {
    expect(supportsSystemAudioSession()).toBe(false);
  });
});

describe('applySystemAudioSessionType', () => {
  it('sets the type and reports success', () => {
    const { host } = makeHost();
    expect(applySystemAudioSessionType('playback', host)).toBe(true);
    expect(host.audioSession?.type).toBe('playback');
    expect(applySystemAudioSessionType('ambient', host)).toBe(true);
    expect(host.audioSession?.type).toBe('ambient');
  });

  it('skips the write when the session already has the type', () => {
    const { host, writes } = makeHost('playback');
    expect(applySystemAudioSessionType('playback', host)).toBe(true);
    expect(writes).toEqual([]);
  });

  it('is a no-op returning false without an audio session', () => {
    expect(applySystemAudioSessionType('playback', {})).toBe(false);
    expect(applySystemAudioSessionType('playback', undefined)).toBe(false);
  });

  it('returns false when the session ignores the value', () => {
    const { host } = makeHost();
    expect(applySystemAudioSessionType('bogus' as 'auto', host)).toBe(false);
    expect(host.audioSession?.type).toBe('auto');
  });

  it('swallows a throwing setter', () => {
    const host: SystemAudioSessionHost = {
      audioSession: {
        get type() {
          return 'auto';
        },
        set type(_value: string) {
          throw new Error('NotAllowedError');
        },
      },
    };
    expect(applySystemAudioSessionType('playback', host)).toBe(false);
  });
});

describe('resolveSilentModeAudioSessionType', () => {
  it('maps on to playback and off to the browser default', () => {
    expect(resolveSilentModeAudioSessionType(true)).toBe('playback');
    expect(resolveSilentModeAudioSessionType(false)).toBe('auto');
  });
});

describe('applySilentModePlayback', () => {
  it('switches to playback and restores auto', () => {
    const { host, writes } = makeHost();
    expect(applySilentModePlayback(true, host)).toBe(true);
    expect(host.audioSession?.type).toBe('playback');
    expect(applySilentModePlayback(false, host)).toBe(true);
    expect(host.audioSession?.type).toBe('auto');
    expect(writes).toEqual(['playback', 'auto']);
  });

  it('leaves the default session alone when off', () => {
    const { writes, host } = makeHost();
    expect(applySilentModePlayback(false, host)).toBe(true);
    expect(writes).toEqual([]);
  });

  it('is a no-op without the API', () => {
    expect(applySilentModePlayback(true, {})).toBe(false);
  });
});
