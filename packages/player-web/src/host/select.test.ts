import type { Lr2Skin } from '@be-music/lr2-skin';
import { describe, expect, it, vi } from 'vite-plus/test';
import { SILENT_AUDIO } from '../runtime/audio-analysis.ts';
import type { AudioService } from '../runtime/audio-service.ts';
import { makeChart, makeCollection } from '../session/select/test-support.ts';
import type { SessionKeyTarget } from '../session/session-scene.ts';
import { phantomSkin } from '../skins/phantom/index.ts';
import { BuiltInSelectView } from '../view/built-in/select-view.ts';
import type { BuiltInKit } from './family-kit.ts';
import { createSelectScene } from './select.ts';

/** A key target the test presses keys on. */
function createKeys() {
  const listeners = new Set<(event: KeyboardEvent) => void>();
  const target: SessionKeyTarget = {
    addEventListener: (type, listener) => {
      if (type === 'keydown') listeners.add(listener);
    },
    removeEventListener: (type, listener) => {
      if (type === 'keydown') listeners.delete(listener);
    },
  };
  const press = (key: string, code = key): void => {
    const event = { key, code, repeat: false, timeStamp: 0, target: null, preventDefault: vi.fn() };
    for (const listener of Array.from(listeners)) listener(event as unknown as KeyboardEvent);
  };
  return { target, press };
}

function createFakeAudio() {
  const audio = {
    playBgm: vi.fn(async () => true),
    stopBgm: vi.fn(),
    playCue: vi.fn(async () => true),
    playJingle: vi.fn(async () => true),
    stopOwned: vi.fn(),
    resume: vi.fn(),
    preview: { focus: vi.fn(), stop: vi.fn(), playing: false },
    analyzer: { sample: () => SILENT_AUDIO },
  };
  return { audio, service: audio as unknown as AudioService };
}

const KIT: BuiltInKit = { family: 'built-in', skin: phantomSkin, effects: 'off' };

describe('createSelectScene', () => {
  it('is the built-in family’s select screen, taking no keys off the stage', () => {
    const keys = createKeys();
    const { service, audio } = createFakeAudio();
    const start = vi.fn();
    const scene = createSelectScene(KIT, {
      library: makeCollection([makeChart('a', 'pack'), makeChart('b', 'pack')]),
      sounds: { decideBgm: { bytes: new Uint8Array([1]) } },
      audio: service,
      on: { start },
      keyTarget: keys.target,
      now: () => 0,
    });
    expect(scene.identity).toEqual({ kind: 'select', family: 'built-in' });
    keys.press('Enter');
    expect(start).not.toHaveBeenCalled();
    expect(audio.playBgm).not.toHaveBeenCalled();
    scene.dispose();
  });

  it('keeps its place and play options for the host, and ignores a kit of another family', () => {
    const { service } = createFakeAudio();
    const scene = createSelectScene(KIT, {
      library: makeCollection([makeChart('a', 'one'), makeChart('b', 'two')]),
      browse: { folderPath: ['two'], cursors: [1, 0] },
      playOptions: { sort: 'TITLE' },
      sounds: {},
      audio: service,
      on: { start: () => undefined },
      now: () => 0,
    });
    expect(scene.snapshot()).toMatchObject({ folderPath: ['two'], focusKey: 'chart:b' });
    expect(scene.getPlayOptions().sort).toBe('TITLE');
    scene.setPlayOptions({ sort: 'LEVEL' });
    expect(scene.getPlayOptions().sort).toBe('LEVEL');
    scene.restore({ folderPath: ['one'], cursors: [0, 0] });
    expect(scene.focused()).toMatchObject({ song: { id: 'a' } });
    expect(scene.searchFieldRect()).toBeUndefined();
    scene.updateKit({ family: 'lr2' } as unknown as BuiltInKit);
    scene.dispose();
  });
});

describe('createSelectScene with an LR2 kit', () => {
  it('is the LR2 family’s select screen, with no launch outro, and keeps its family', () => {
    const { service } = createFakeAudio();
    const start = vi.fn();
    const scene = createSelectScene(
      { family: 'lr2', skin: {} as Lr2Skin },
      {
        library: makeCollection([makeChart('a', 'pack')]),
        sounds: {},
        audio: service,
        on: { start },
        now: () => 0,
      },
    );
    expect(scene.identity).toEqual({ kind: 'select', family: 'lr2' });
    expect(() => scene.updateKit(KIT)).not.toThrow();
    expect(scene.identity).toEqual({ kind: 'select', family: 'lr2' });
    scene.dispose();
  });
});

describe('BuiltInSelectView', () => {
  it('plays the skin’s launch outro unless its effects are off', () => {
    const outro = { ...phantomSkin, select: { ...phantomSkin.select, outroMs: 600 } };
    expect(new BuiltInSelectView({ family: 'built-in', skin: outro }).launchOutroMs).toBe(600);
    expect(new BuiltInSelectView({ family: 'built-in', skin: outro, effects: 'off' }).launchOutroMs).toBe(0);
  });
});
