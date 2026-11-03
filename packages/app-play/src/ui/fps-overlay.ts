// The frame rate readout (`#fps-overlay`), as beatoraja's F1 and LR2's F7 show it: switched on and off by its key, it
// counts the frames the page draws and shows how many a second, every half second. It reads only the page's frames, so
// it runs nothing while it is hidden.

/** How often the readout changes, and over how long it counts. */
export const FPS_SAMPLE_MS = 500;

/** The frame rate of `frames` frames drawn over `elapsedMs`, rounded; 0 over no time. */
export function framesPerSecond(frames: number, elapsedMs: number): number {
  return elapsedMs > 0 ? Math.round((frames * 1000) / elapsedMs) : 0;
}

/** The readout's switch. */
export interface FpsOverlay {
  /** Shows the readout when hidden, hides it when shown. */
  toggle(): void;
  readonly shown: boolean;
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
    toggle() {
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
    get shown() {
      return handle !== undefined;
    },
  };
}
