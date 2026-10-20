import { describe, expect, it } from 'vite-plus/test';
import { PlayLock, type LockableControl, type PlayLockControls } from './play-lock.ts';

/** A stand-in for a lil-gui controller: lil-gui's `enable(false)` disables, as `disable()` does. */
class FakeControl implements LockableControl {
  public enabled = true;
  public enable(enabled = true): this {
    this.enabled = enabled;
    return this;
  }
  public disable(disabled = true): this {
    this.enabled = !disabled;
    return this;
  }
}

function menuControls() {
  const autoPlay = new FakeControl();
  const tempo = new FakeControl();
  const controls = {
    replaySave: new FakeControl(),
    playOptions: [autoPlay, tempo],
    tempo,
    skinSystem: new FakeControl(),
    lr2Theme: undefined as FakeControl | undefined,
    builtInSkin: new FakeControl(),
  };
  const read = (): PlayLockControls => ({
    replaySave: controls.replaySave,
    playOptions: controls.playOptions,
    tempo: controls.tempo,
    skin: [controls.skinSystem, controls.lr2Theme, controls.builtInSkin],
  });
  return { controls, autoPlay, read };
}

describe('PlayLock', () => {
  it('disables the latched options and the skin controls during a play', () => {
    const { controls, autoPlay, read } = menuControls();
    const lock = new PlayLock(read);

    lock.lock();

    expect(controls.replaySave.enabled).toBe(false);
    expect(autoPlay.enabled).toBe(false);
    expect(controls.tempo.enabled).toBe(false);
    expect(controls.skinSystem.enabled).toBe(false);
    expect(controls.builtInSkin.enabled).toBe(false);
    expect(lock.skinControlsLocked).toBe(true);
    expect(lock.liveTempoPlay).toBe(false);
  });

  it('keeps the tempo slider for a play whose tempo changes live', () => {
    const { controls, autoPlay, read } = menuControls();
    const lock = new PlayLock(read);

    lock.lock(true);

    expect(controls.tempo.enabled).toBe(true);
    expect(autoPlay.enabled).toBe(false);
    expect(lock.liveTempoPlay).toBe(true);
  });

  it('enables everything again once the play is over', () => {
    const { controls, autoPlay, read } = menuControls();
    const lock = new PlayLock(read);
    lock.lock(true);

    lock.unlock();

    expect(controls.replaySave.enabled).toBe(true);
    expect(autoPlay.enabled).toBe(true);
    expect(controls.tempo.enabled).toBe(true);
    expect(controls.skinSystem.enabled).toBe(true);
    expect(controls.builtInSkin.enabled).toBe(true);
    expect(lock.skinControlsLocked).toBe(false);
    expect(lock.liveTempoPlay).toBe(false);
  });

  it('reads the controls as it changes, so a picker made after the menu is built is locked too', () => {
    const { controls, read } = menuControls();
    const lock = new PlayLock(read);
    // An LR2 theme dropped before the play: its picker is made after the menu.
    controls.lr2Theme = new FakeControl();

    lock.lock();
    expect(controls.lr2Theme.enabled).toBe(false);

    lock.unlock();
    expect(controls.lr2Theme.enabled).toBe(true);
  });

  it('skips the controls not made yet', () => {
    const lock = new PlayLock(() => ({ replaySave: undefined, playOptions: [], tempo: undefined, skin: [undefined] }));

    expect(() => lock.lock(true)).not.toThrow();
    expect(() => lock.unlock()).not.toThrow();
  });
});
