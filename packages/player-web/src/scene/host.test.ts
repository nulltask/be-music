import { Container, RendererType, type Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { BeatorajaSkin } from '@be-music/beatoraja-skin';
import type { SceneIdentity } from '../host/family-kit.ts';
import type { BeatorajaTextureCache } from '../skin/beatoraja/textures.ts';
import { PixiBeatorajaDecideScene } from './beatoraja/decide.ts';
import { PixiBeatorajaSelectScene } from './beatoraja/select.ts';
import { CoreGameplayView } from './core/gameplay.ts';
import { CoreResultView } from './core/result.ts';
import { CoreSongSelectView } from './core/select.ts';
import { DefaultPixiGameplayView, DefaultPixiResultView, DefaultPixiSongSelectView } from './default/index.ts';
import { PixiSceneHost, resolveRendererPreference, resolveRenderResolution, type PixiScene } from './host.ts';
import { PixiDecideView } from './lr2/decide.ts';
import { PixiGameplayView } from './lr2/gameplay.ts';
import { PixiResultView } from './lr2/result.ts';
import { PixiSongSelectView } from './lr2/select.ts';

function makeScene(overrides: Partial<PixiScene> = {}): PixiScene {
  return {
    root: new Container(),
    identity: { kind: 'select', family: 'built-in' },
    enter: vi.fn(),
    exit: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
}

/**
 * A scene that writes each lifecycle call to `log` as `<name>.<call>`, with whether its root was on the host's stage at
 * that moment (`on` / `off`).
 */
function makeLoggedScene(
  name: string,
  host: PixiSceneHost,
  log: string[],
  overrides: Partial<PixiScene> = {},
): PixiScene {
  const root = new Container();
  const stage = (): string => (root.parent === host.app.stage ? 'on' : 'off');
  return makeScene({
    root,
    enter: vi.fn(() => {
      log.push(`${name}.enter ${stage()}`);
    }),
    exit: vi.fn(() => {
      log.push(`${name}.exit ${stage()}`);
    }),
    dispose: vi.fn(() => {
      log.push(`${name}.dispose`);
    }),
    ...overrides,
  });
}

describe('resolveRendererPreference', () => {
  // Defaults to WebGPU per the project policy. PixiJS auto-falls- back to WebGL2 inside `Application.init` if the
  // browser doesn't expose WebGPU, so the default is safe even on older platforms.
  it('returns "webgpu" by default when no flag is present', () => {
    expect(resolveRendererPreference('')).toBe('webgpu');
    expect(resolveRendererPreference('?')).toBe('webgpu');
    expect(resolveRendererPreference('?other=value')).toBe('webgpu');
  });

  it('returns "webgpu" for the explicit `?renderer=webgpu` form', () => {
    // The explicit form is accepted as documentation in deployed URLs even though it's redundant with the default.
    expect(resolveRendererPreference('?renderer=webgpu')).toBe('webgpu');
  });

  it('returns "webgl" only for the exact `?renderer=webgl` form', () => {
    expect(resolveRendererPreference('?renderer=webgl')).toBe('webgl');
  });

  it('falls back to "webgpu" for unrecognized renderer values', () => {
    // Strict allow-list — typoed flags shouldn't silently disable WebGPU on a user's machine. They get the default and
    // can fix their URL.
    expect(resolveRendererPreference('?renderer=canvas')).toBe('webgpu');
    expect(resolveRendererPreference('?renderer=WebGL')).toBe('webgpu');
    expect(resolveRendererPreference('?renderer=')).toBe('webgpu');
  });
});

describe('PixiSceneHost', () => {
  it('keeps texture GC sweeps out of the hot gameplay cadence', async () => {
    const host = new PixiSceneHost();
    const canvas = {
      setAttribute: vi.fn(),
      style: {} as Record<string, string>,
      tabIndex: 0,
    };
    const init = vi.spyOn(host.app, 'init').mockImplementation(async function initMock(this: typeof host.app, options) {
      (this as unknown as { renderer: { canvas: typeof canvas; type: RendererType } }).renderer = {
        canvas,
        type: RendererType.WEBGL,
      };
      expect(options).toEqual(
        expect.objectContaining({
          gcFrequency: 60_000,
          gcMaxUnusedTime: 120_000,
        }),
      );
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;

    try {
      await host.mount(container);

      expect(init).toHaveBeenCalledTimes(1);
      expect(container.appendChild).toHaveBeenCalledWith(canvas);
    } finally {
      info.mockRestore();
      init.mockRestore();
    }
  });

  it('disposes and forgets a scene whose enter hook fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const host = new PixiSceneHost();
    const error = new Error('enter failed');
    const scene = makeScene({
      enter: vi.fn(() => {
        throw error;
      }),
    });

    try {
      await expect(host.setScene(scene)).rejects.toThrow(error);

      expect(scene.dispose).toHaveBeenCalled();
      expect(host.getCurrentScene()).toBeUndefined();
      expect(scene.root.parent).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('PixiSceneHost scene lifecycle', () => {
  it('exits the previous scene and takes its root off the stage before the next one enters and goes on', async () => {
    const host = new PixiSceneHost();
    const log: string[] = [];
    const select = makeLoggedScene('select', host, log);
    const decide = makeLoggedScene('decide', host, log);

    await host.setScene(select);
    expect(host.app.stage.children).toEqual([select.root]);
    await host.setScene(decide);

    // Each scene enters off the stage (the host puts its root on once `enter` returns) and exits still on it.
    expect(log).toEqual(['select.enter off', 'select.exit on', 'decide.enter off']);
    expect(host.app.stage.children).toEqual([decide.root]);
    // A transition only exits: disposing is the owner's call.
    expect(select.dispose).not.toHaveBeenCalled();
  });

  it('keeps a scene alive across others and enters it again (the select screen across a play)', async () => {
    const host = new PixiSceneHost();
    const log: string[] = [];
    const select = makeLoggedScene('select', host, log);
    const decide = makeLoggedScene('decide', host, log);
    const play = makeLoggedScene('play', host, log);

    await host.setScene(select);
    await host.setScene(decide);
    await host.setScene(play);
    await host.setScene(select);

    expect(log).toEqual([
      'select.enter off',
      'select.exit on',
      'decide.enter off',
      'decide.exit on',
      'play.enter off',
      'play.exit on',
      'select.enter off',
    ]);
    expect(select.enter).toHaveBeenCalledTimes(2);
    expect(select.enter).toHaveBeenLastCalledWith(host);
    expect(select.exit).toHaveBeenCalledTimes(1);
    expect(select.dispose).not.toHaveBeenCalled();
    expect(host.app.stage.children).toEqual([select.root]);
    expect(host.getCurrentScene()).toBe(select);
  });

  it('clears the stage with undefined: the active scene exits and none is left', async () => {
    const host = new PixiSceneHost();
    const log: string[] = [];
    const select = makeLoggedScene('select', host, log);

    await host.setScene(select);
    await host.setScene(undefined);

    expect(log).toEqual(['select.enter off', 'select.exit on']);
    expect(host.app.stage.children).toEqual([]);
    expect(host.getCurrentScene()).toBeUndefined();
  });

  it('does nothing when the active scene is set again', async () => {
    const host = new PixiSceneHost();
    const log: string[] = [];
    const select = makeLoggedScene('select', host, log);

    await host.setScene(select);
    await host.setScene(select);

    expect(log).toEqual(['select.enter off']);
    expect(host.app.stage.children).toEqual([select.root]);
  });

  it('runs transitions one at a time in call order, waiting for an exit that resolves later', async () => {
    const host = new PixiSceneHost();
    const log: string[] = [];
    let finishExit: () => void = () => undefined;
    const slow = makeLoggedScene('slow', host, log, {
      exit: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            log.push('slow.exit started');
            finishExit = () => {
              log.push('slow.exit done');
              resolve();
            };
          }),
      ),
    });
    const decide = makeLoggedScene('decide', host, log);
    const play = makeLoggedScene('play', host, log);
    await host.setScene(slow);

    const toDecide = host.setScene(decide);
    const toPlay = host.setScene(play);
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(['slow.enter off', 'slow.exit started']);
    finishExit();
    await Promise.all([toDecide, toPlay]);

    expect(log).toEqual([
      'slow.enter off',
      'slow.exit started',
      'slow.exit done',
      'decide.enter off',
      'decide.exit on',
      'play.enter off',
    ]);
    expect(host.app.stage.children).toEqual([play.root]);
  });

  it("reports the active scene's identity from the moment its transition starts", async () => {
    const host = new PixiSceneHost();
    const select = makeScene({ identity: { kind: 'select', family: 'lr2' } });
    const play = makeScene({ identity: { kind: 'play', family: 'beatoraja' } });
    expect(host.getCurrentScene()?.identity).toBeUndefined();

    await host.setScene(select);
    expect(host.getCurrentScene()?.identity).toEqual({ kind: 'select', family: 'lr2' });
    const toPlay = host.setScene(play);
    await Promise.resolve();
    expect(host.getCurrentScene()?.identity).toEqual({ kind: 'play', family: 'beatoraja' });
    await toPlay;
    await host.setScene(undefined);
    expect(host.getCurrentScene()).toBeUndefined();
  });
});

describe('scene identities', () => {
  // The getters live on each class's prototype, so they read without building a scene.
  const cases: [string, SceneIdentity, SceneIdentity][] = [
    ['CoreSongSelectView', CoreSongSelectView.prototype.identity, { kind: 'select', family: 'built-in' }],
    ['DefaultPixiSongSelectView', DefaultPixiSongSelectView.prototype.identity, { kind: 'select', family: 'built-in' }],
    ['PixiSongSelectView', PixiSongSelectView.prototype.identity, { kind: 'select', family: 'lr2' }],
    ['PixiDecideView', PixiDecideView.prototype.identity, { kind: 'decide', family: 'lr2' }],
    ['CoreGameplayView', CoreGameplayView.prototype.identity, { kind: 'play', family: 'built-in' }],
    ['DefaultPixiGameplayView', DefaultPixiGameplayView.prototype.identity, { kind: 'play', family: 'built-in' }],
    ['PixiGameplayView', PixiGameplayView.prototype.identity, { kind: 'play', family: 'lr2' }],
    ['CoreResultView', CoreResultView.prototype.identity, { kind: 'result', family: 'built-in' }],
    ['DefaultPixiResultView', DefaultPixiResultView.prototype.identity, { kind: 'result', family: 'built-in' }],
    ['PixiResultView', PixiResultView.prototype.identity, { kind: 'result', family: 'lr2' }],
  ];

  it.each(cases)('%s names its screen and family', (_name, identity, expected) => {
    expect(identity).toEqual(expected);
  });

  it('names the beatoraja select and decide scenes', () => {
    const skin: BeatorajaSkin = { type: 5, w: 1280, h: 720, image: [], destination: [] };
    const empty = new Map<number | string, Texture>();
    const textures: BeatorajaTextureCache = {
      get: (id) => empty.get(id),
      values: () => empty.values(),
      pathOf: () => undefined,
    };
    const select = new PixiBeatorajaSelectScene({ skin, textures, songs: [], onSongPicked: () => undefined });
    const decide = new PixiBeatorajaDecideScene({ skin, textures });
    try {
      expect(select.identity).toEqual({ kind: 'select', family: 'beatoraja' });
      expect(decide.identity).toEqual({ kind: 'decide', family: 'beatoraja' });
    } finally {
      select.dispose();
      decide.dispose();
    }
  });
});

describe('resolveRenderResolution', () => {
  it('keeps the display ratio without ?resolution=', () => {
    expect(resolveRenderResolution(2, '')).toBe(2);
    expect(resolveRenderResolution(3, '?renderer=webgl')).toBe(3);
  });

  it('caps the display ratio', () => {
    expect(resolveRenderResolution(2, '?resolution=1')).toBe(1);
    expect(resolveRenderResolution(3, '?resolution=1.5')).toBe(1.5);
  });

  it('never raises the ratio above the display', () => {
    expect(resolveRenderResolution(1, '?resolution=2')).toBe(1);
  });

  it('goes no lower than 0.5', () => {
    expect(resolveRenderResolution(2, '?resolution=0.1')).toBe(0.5);
  });

  it('ignores values that are not positive numbers', () => {
    for (const search of [
      '?resolution=',
      '?resolution=abc',
      '?resolution=0',
      '?resolution=-1',
      '?resolution=Infinity',
    ]) {
      expect(resolveRenderResolution(2, search)).toBe(2);
    }
  });

  it('uses the requested resolution when the URL has none', () => {
    expect(resolveRenderResolution(2, '', 1.5)).toBe(1.5);
    expect(resolveRenderResolution(1, '', 1.5)).toBe(1);
    expect(resolveRenderResolution(2, '', 0.2)).toBe(0.5);
    expect(resolveRenderResolution(2, '', Number.NaN)).toBe(2);
  });

  it('lets ?resolution= override the requested resolution', () => {
    expect(resolveRenderResolution(2, '?resolution=1', 1.5)).toBe(1);
    expect(resolveRenderResolution(2, '?resolution=abc', 1.5)).toBe(1.5);
  });

  it('falls back to 1 for a missing display ratio', () => {
    expect(resolveRenderResolution(Number.NaN, '')).toBe(1);
    expect(resolveRenderResolution(0, '?resolution=1.5')).toBe(1);
  });
});
