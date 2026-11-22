// The FPS readout is switched by Options or the active scheme's shortcut (beatoraja F1, LR2 F7).
// While visible it counts page frames and updates twice a second.

/** How often the readout changes, and over how long it counts. */
export const FPS_SAMPLE_MS = 500;

/** The frame rate of `frames` frames drawn over `elapsedMs`, rounded; 0 over no time. */
export function framesPerSecond(frames: number, elapsedMs: number): number {
  return elapsedMs > 0 ? Math.round((frames * 1000) / elapsedMs) : 0;
}

export interface FpsOverlay {
  setShown(shown: boolean): void;
}

/** The readout over `element`, hidden until it is switched on. */
export function createFpsOverlay(element: HTMLElement): FpsOverlay {
  let handle: number | undefined;
  let frames = 0;
  let since = 0;
  const tick = (now: number): void => {
    frames += 1;
    if (now - since >= FPS_SAMPLE_MS) {
      element.textContent = `${framesPerSecond(frames, now - since)} FPS`;
      frames = 0;
      since = now;
    }
    handle = requestAnimationFrame(tick);
  };
  return {
    setShown(shown) {
      if (shown === (handle !== undefined)) return;
      if (handle !== undefined) {
        cancelAnimationFrame(handle);
        handle = undefined;
        element.hidden = true;
        return;
      }
      element.textContent = '— FPS';
      element.hidden = false;
      frames = 0;
      since = performance.now();
      handle = requestAnimationFrame(tick);
    },
  };
}
