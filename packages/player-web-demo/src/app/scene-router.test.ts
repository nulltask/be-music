import type { PixiScene, PixiSceneHost, PlayScene } from '@be-music/player-web/scenes';
import { describe, expect, test, vi } from 'vite-plus/test';
import { SceneRouter, type RoutedPlayScene, type RoutedScene, type SceneRouterHost } from './scene-router.ts';

interface Gate {
  readonly promise: Promise<void>;
  open(): void;
  fail(error: Error): void;
}

function gate(): Gate {
  let open!: () => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

/** Lets every pending promise callback run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

/** A scene that logs its lifecycle; `enter` can wait on a gate. */
class FakeScene implements RoutedScene {
  readonly name: string;
  protected readonly log: string[];
  enterGate: Gate | undefined;

  constructor(name: string, log: string[]) {
    this.name = name;
    this.log = log;
  }

  async enter(): Promise<void> {
    this.log.push(`enter:${this.name}`);
    await this.enterGate?.promise;
  }

  exit(): void {
    this.log.push(`exit:${this.name}`);
  }

  dispose(): void {
    this.log.push(`dispose:${this.name}`);
  }
}

/** A play scene: `prepare` can wait on a gate, and `dispose` takes the play's options. */
class FakePlay extends FakeScene implements RoutedPlayScene {
  prepareGate: Gate | undefined;

  async prepare(onProgress?: (progress: number) => void): Promise<void> {
    this.log.push(`prepare:${this.name}`);
    await this.prepareGate?.promise;
    onProgress?.(1);
  }

  override dispose(options: { preserveAudioTail?: boolean } = {}): void {
    this.log.push(`dispose:${this.name}${options.preserveAudioTail === true ? ':tail' : ''}`);
  }
}

/** The stage as `PixiSceneHost` runs it: the scene showing exits, then the next enters. */
class FakeHost implements SceneRouterHost<FakeScene> {
  current: FakeScene | undefined;
  private readonly log: string[];

  constructor(log: string[]) {
    this.log = log;
  }

  async setScene(scene: FakeScene | undefined): Promise<void> {
    this.log.push(`setScene:${scene?.name ?? 'none'}`);
    if (this.current === scene) return;
    const previous = this.current;
    this.current = scene;
    previous?.exit();
    await scene?.enter();
  }
}

function setup(options: { onError?: (error: unknown, step: string) => void } = {}) {
  const log: string[] = [];
  const host = new FakeHost(log);
  const finalize = vi.fn(async (): Promise<void> => {
    log.push('finalize');
  });
  const router = new SceneRouter<FakeScene, FakePlay>({
    host,
    recorder: { finalize },
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
  return {
    log,
    host,
    finalize,
    router,
    scene: (name: string) => new FakeScene(name, log),
    play: (name: string) => new FakePlay(name, log),
  };
}

const withTail = (play: FakePlay): void => play.dispose({ preserveAudioTail: true });

describe('SceneRouter.show', () => {
  test('finalizes the recording, hands the stage over in one setScene, then disposes the scene that went', async () => {
    const { router, log, host, scene, play } = setup();
    const select = scene('select');
    const gameplay = play('play');
    const result = scene('result');
    await router.show(select, { role: 'select' });
    await router.show(gameplay, { role: 'play' });
    log.length = 0;

    const shown = router.show(result, { role: 'result', playDispose: withTail });
    expect(log).toEqual([]);
    await expect(shown).resolves.toBe(true);
    // The play exits as the result enters (the stage is never empty), and goes once the result is up.
    expect(log).toEqual(['finalize', 'setScene:result', 'exit:play', 'enter:result', 'dispose:play:tail']);
    expect(host.current).toBe(result);
    expect(router.current).toBe(result);
    expect(router.play).toBeUndefined();
    expect(router.select).toBe(select);
  });

  test('keeps the select scene alive across a decide, a play and a result, and enters it again', async () => {
    const { router, log, scene, play } = setup();
    const select = scene('select');
    const decide = scene('decide');
    const gameplay = play('play');
    const result = scene('result');
    await router.show(select, { role: 'select' });
    await router.prepare(gameplay);
    await router.show(decide, { role: 'decide' });
    await router.show(gameplay, { role: 'play' });
    await router.show(result, { role: 'result', playDispose: withTail });
    await router.show(select, { role: 'select' });

    expect(log.filter((entry) => entry.startsWith('dispose:'))).toEqual([
      'dispose:decide',
      'dispose:play:tail',
      'dispose:result',
    ]);
    expect(log.filter((entry) => entry === 'enter:select')).toHaveLength(2);
    expect(log.filter((entry) => entry === 'exit:select')).toHaveLength(1);
    expect(log).not.toContain('setScene:none');
    expect(router.select).toBe(select);
    expect(router.current).toBe(select);
  });

  test('the decide screen hands the stage to the prepared play, then goes', async () => {
    const { router, log, scene, play } = setup();
    const decide = scene('decide');
    const gameplay = play('play');
    await router.prepare(gameplay);
    await router.show(decide, { role: 'decide' });
    expect(router.play).toBe(gameplay);
    log.length = 0;
    await router.show(gameplay, { role: 'play' });
    expect(log).toEqual(['finalize', 'setScene:play', 'exit:decide', 'enter:play', 'dispose:decide']);
    expect(router.play).toBe(gameplay);
  });

  test('a new select scene replaces the kept one, which goes once the new one is up', async () => {
    const { router, log, scene, play } = setup();
    const first = scene('select1');
    const second = scene('select2');
    await router.show(first, { role: 'select' });
    log.length = 0;
    await router.show(second, { role: 'select' });
    expect(log).toEqual(['finalize', 'setScene:select2', 'exit:select1', 'enter:select2', 'dispose:select1']);
    expect(router.select).toBe(second);

    // Off stage too: a play goes back to a new select scene, and both the play and the old select go.
    const gameplay = play('play');
    const third = scene('select3');
    await router.show(gameplay, { role: 'play' });
    log.length = 0;
    await router.show(third, { role: 'select' });
    expect(log).toEqual([
      'finalize',
      'setScene:select3',
      'exit:play',
      'enter:select3',
      'dispose:play',
      'dispose:select2',
    ]);
    expect(router.select).toBe(third);
  });

  test('a play started again replaces the play on stage, which goes after the new one entered', async () => {
    const { router, log, play } = setup();
    const first = play('play1');
    const second = play('play2');
    await router.show(first, { role: 'play' });
    log.length = 0;
    await router.show(second, { role: 'play' });
    await router.prepare(second);
    expect(log).toEqual(['finalize', 'setScene:play2', 'exit:play1', 'enter:play2', 'dispose:play1', 'prepare:play2']);
    expect(router.play).toBe(second);
  });

  test('a kept scene of another role is exited but left for its owner to dispose', async () => {
    const { router, log, scene } = setup();
    const result = scene('result');
    await router.show(result, { role: 'result', keep: true });
    await router.show(scene('select'), { role: 'select' });
    expect(log).toContain('exit:result');
    expect(log).not.toContain('dispose:result');
  });
});

describe('SceneRouter transitions in line', () => {
  test('a transition starts only once the one before it has handed the stage over', async () => {
    const { router, log, scene } = setup();
    const slow = scene('slow');
    const enterGate = gate();
    slow.enterGate = enterGate;
    const first = router.show(slow, { role: 'decide' });
    await settle();
    const second = router.show(scene('next'), { role: 'result' });
    await settle();
    expect(log).toEqual(['finalize', 'setScene:slow', 'enter:slow']);
    enterGate.open();
    await Promise.all([first, second]);
    expect(log).toEqual([
      'finalize',
      'setScene:slow',
      'enter:slow',
      'finalize',
      'setScene:next',
      'exit:slow',
      'enter:next',
      'dispose:slow',
    ]);
  });

  test('waits for the recording to be finalized before the stage changes or the play goes', async () => {
    const { router, log, finalize, play, scene } = setup();
    await router.show(play('play'), { role: 'play' });
    log.length = 0;
    const saving = gate();
    finalize.mockImplementationOnce(async () => {
      log.push('finalize');
      await saving.promise;
    });
    const toResult = router.show(scene('result'), { role: 'result', playDispose: withTail });
    await settle();
    expect(log).toEqual(['finalize']);
    saving.open();
    await toResult;
    expect(log).toEqual(['finalize', 'setScene:result', 'exit:play', 'enter:result', 'dispose:play:tail']);
  });
});

describe('SceneRouter generations', () => {
  test('a scene built for a navigation a newer one replaced is disposed instead of shown', async () => {
    const { router, log, scene } = setup();
    const select = scene('select');
    const token = router.begin();
    // The player goes back to the select screen while the result is still being built.
    await router.show(select, { role: 'select' });
    expect(router.isCurrent(token)).toBe(false);
    const late = scene('result');
    await expect(router.show(late, { role: 'result', token })).resolves.toBe(false);
    expect(log).toContain('dispose:result');
    expect(log).not.toContain('enter:result');
    expect(router.current).toBe(select);
  });

  test('a transition in line goes stale when a newer navigation begins before its turn', async () => {
    const { router, log, scene } = setup();
    const select = scene('select');
    await router.show(select, { role: 'select' });
    const decide = scene('decide');
    const enterGate = gate();
    decide.enterGate = enterGate;
    const token = router.begin();
    const toDecide = router.show(decide, { role: 'decide', token });
    await settle();
    const toResult = router.show(scene('result'), { role: 'result', token });
    const back = router.show(select, { role: 'select' });
    enterGate.open();
    await expect(toDecide).resolves.toBe(true);
    await expect(toResult).resolves.toBe(false);
    await expect(back).resolves.toBe(true);
    expect(log).not.toContain('enter:result');
    expect(log).toContain('dispose:result');
    expect(log).toContain('dispose:decide');
    expect(router.current).toBe(select);
  });

  test('a transition still in line when a newer navigation begins does not run', async () => {
    const { router, log, scene } = setup();
    const first = router.show(scene('first'), { role: 'decide' });
    const second = router.show(scene('second'), { role: 'result' });
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(log).toEqual(['dispose:first', 'finalize', 'setScene:second', 'enter:second']);
  });

  test('a token handed to the transitions of one navigation keeps them all current', async () => {
    const { router, scene, play } = setup();
    await router.show(scene('select'), { role: 'select' });
    const token = router.begin();
    const gameplay = play('play');
    await expect(router.leave({ token })).resolves.toBe(true);
    await expect(router.prepare(gameplay, { token })).resolves.toBe(true);
    await expect(router.show(gameplay, { role: 'play', token })).resolves.toBe(true);
    expect(router.isCurrent(token)).toBe(true);
  });

  test('a prepared play goes when the decide screen is left for the select screen, and only once', async () => {
    const { router, log, scene, play } = setup();
    const select = scene('select');
    await router.show(select, { role: 'select' });
    const token = router.begin();
    const gameplay = play('play');
    const prepareGate = gate();
    gameplay.prepareGate = prepareGate;
    const loading = router.prepare(gameplay, { token });
    await router.show(scene('decide'), { role: 'decide', token });
    expect(router.play).toBe(gameplay);
    expect(log).not.toContain('dispose:play');

    // ESC on the decide screen.
    await router.show(select, { role: 'select' });
    expect(router.play).toBeUndefined();
    prepareGate.open();
    await expect(loading).resolves.toBe(false);
    await expect(router.show(gameplay, { role: 'play', token })).resolves.toBe(false);
    expect(log.filter((entry) => entry === 'dispose:play')).toHaveLength(1);
    expect(log).not.toContain('enter:play');
  });

  test('a play prepared for a stale navigation is disposed without loading', async () => {
    const { router, log, play } = setup();
    const token = router.begin();
    router.begin();
    await expect(router.prepare(play('play'), { token })).resolves.toBe(false);
    expect(log).toEqual(['dispose:play']);
  });
});

describe('SceneRouter.prepare', () => {
  test('loads the play off stage and reports its progress', async () => {
    const { router, log, play } = setup();
    const gameplay = play('play');
    const progress = vi.fn();
    await expect(router.prepare(gameplay, { onProgress: progress })).resolves.toBe(true);
    expect(log).toEqual(['prepare:play']);
    expect(progress).toHaveBeenCalledWith(1);
    expect(router.play).toBe(gameplay);
    expect(router.current).toBeUndefined();
  });

  test('disposes a play that fails to load off stage, and rethrows', async () => {
    const { router, log, play } = setup();
    const gameplay = play('play');
    const prepareGate = gate();
    gameplay.prepareGate = prepareGate;
    const loading = router.prepare(gameplay);
    prepareGate.fail(new Error('no samples'));
    await expect(loading).rejects.toThrow('no samples');
    expect(log).toEqual(['prepare:play', 'dispose:play']);
    expect(router.play).toBeUndefined();
  });

  test('replaces a play waiting off stage', async () => {
    const { router, log, play } = setup();
    await router.prepare(play('play1'));
    const second = play('play2');
    await router.prepare(second);
    expect(log).toEqual(['prepare:play1', 'dispose:play1', 'prepare:play2']);
    expect(router.play).toBe(second);
  });

  test('leaves a play on stage to the transition that takes it off', async () => {
    const { router, log, play, scene } = setup();
    const first = play('play1');
    await router.show(first, { role: 'play' });
    await router.prepare(play('play2'));
    expect(log).not.toContain('dispose:play1');
    await router.show(scene('result'), { role: 'result', playDispose: withTail });
    expect(log).toContain('dispose:play1:tail');
  });
});

describe('SceneRouter.leave', () => {
  test('takes the scene off the stage: the kept select stays, a play goes with its playDispose', async () => {
    const { router, log, scene, play } = setup();
    const select = scene('select');
    await router.show(select, { role: 'select' });
    log.length = 0;
    await expect(router.leave()).resolves.toBe(true);
    expect(log).toEqual(['finalize', 'setScene:none', 'exit:select']);
    expect(router.current).toBeUndefined();
    expect(router.select).toBe(select);

    const gameplay = play('play');
    await router.show(gameplay, { role: 'play' });
    log.length = 0;
    await router.leave({ playDispose: withTail });
    expect(log).toEqual(['finalize', 'setScene:none', 'exit:play', 'dispose:play:tail']);
    expect(router.play).toBeUndefined();
  });

  test('drops a play waiting off stage', async () => {
    const { router, log, scene, play } = setup();
    await router.prepare(play('play'));
    await router.show(scene('decide'), { role: 'decide' });
    log.length = 0;
    await router.leave();
    expect(log).toEqual(['finalize', 'setScene:none', 'exit:decide', 'dispose:decide', 'dispose:play']);
  });
});

describe('SceneRouter.dropSelect', () => {
  test('takes the select scene off the stage when it shows, then disposes it', async () => {
    const { router, log, scene } = setup();
    const select = scene('select');
    await router.show(select, { role: 'select' });
    log.length = 0;
    await router.dropSelect();
    expect(log).toEqual(['setScene:none', 'exit:select', 'dispose:select']);
    expect(router.select).toBeUndefined();
    expect(router.current).toBeUndefined();
  });

  test('disposes a select scene off stage and leaves the scene showing alone', async () => {
    const { router, log, scene, play } = setup();
    await router.show(scene('select'), { role: 'select' });
    const gameplay = play('play');
    await router.show(gameplay, { role: 'play' });
    log.length = 0;
    await router.dropSelect();
    expect(log).toEqual(['dispose:select']);
    expect(router.current).toBe(gameplay);
  });

  test('a dropped select scene is never shown again', async () => {
    const { router, log, scene } = setup();
    const select = scene('select');
    await router.show(select, { role: 'select' });
    await router.dropSelect();
    log.length = 0;
    await expect(router.show(select, { role: 'select' })).resolves.toBe(false);
    expect(log).toEqual([]);
  });
});

describe('SceneRouter errors', () => {
  test('a recording that fails to finalize or a scene that throws on dispose does not stop the transition', async () => {
    const onError = vi.fn();
    const { router, finalize, scene, host } = setup({ onError });
    const broken = scene('broken');
    broken.dispose = () => {
      throw new Error('dispose failed');
    };
    await router.show(broken, { role: 'decide' });
    finalize.mockRejectedValueOnce(new Error('recorder failed'));
    const next = scene('next');
    await expect(router.show(next, { role: 'result' })).resolves.toBe(true);
    expect(host.current).toBe(next);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'recorder failed' }), 'finalize');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'dispose failed' }), 'dispose');
  });

  test('a transition that throws leaves the ones after it to run', async () => {
    const { router, host, scene } = setup();
    const failing = vi.spyOn(host, 'setScene').mockRejectedValueOnce(new Error('stage gone'));
    await expect(router.show(scene('first'), { role: 'decide' })).rejects.toThrow('stage gone');
    failing.mockRestore();
    const next = scene('next');
    await expect(router.show(next, { role: 'result' })).resolves.toBe(true);
    expect(router.current).toBe(next);
  });
});

describe('SceneRouter over player-web', () => {
  test('takes the scene host, its scenes and the play scene as they are', () => {
    // Type-level: a `PixiSceneHost` is the stage, a `PixiScene` a scene and a `PlayScene` a play.
    const route = (host: PixiSceneHost, select: PixiScene, play: PlayScene): SceneRouter<PixiScene, PlayScene> => {
      const router = new SceneRouter<PixiScene, PlayScene>({ host, recorder: { finalize: async () => undefined } });
      void router.show(select, { role: 'select' });
      void router.show(play, { role: 'play', playDispose: (gone) => gone.dispose({ preserveAudioTail: true }) });
      return router;
    };
    expect(typeof route).toBe('function');
  });
});
