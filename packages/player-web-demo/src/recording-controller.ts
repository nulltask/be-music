import type { PixiSceneHost } from '@be-music/player-web/scenes';
import { Rectangle, logger } from '@be-music/player-web';
import { downloadBlob, makeWebmSeekable } from '@be-music/player-web/runtime';
import type { Controller } from 'lil-gui';

const recordLog = logger('record');

/**
 * Common recording-API surface both gameplay views (LR2 `PixiGameplayView` and beatoraja `PixiBeatorajaGameplayView`)
 * expose. Narrowed type so {@link activeGameplayRecorder} can return a path-agnostic value the rest of the controller
 * acts on without branching by family.
 */
export interface GameplayRecorder {
  startRecording(): void;
  stopRecording(): Promise<{ blob: Blob; mimeType: string; durationMs: number } | undefined>;
  isRecording(): boolean;
}

/**
 * Dependencies the recording controller's free functions read from / write to. Modelled as explicit getters /
 * setters / callbacks (rather than `this` references) so the demo class can pass them in without having to drop its
 * private modifier on every backing field. Each call site builds one of these inline from the demo's `PlayerWebDemoApp`
 * fields — see `makeRecordingDeps` in `main.ts`.
 */
export interface RecordingDeps {
  readonly sceneHost: PixiSceneHost;
  readonly recordController: Controller | undefined;
  /** Whichever gameplay view is mounted right now, or `undefined` when neither family is active. */
  getActiveGameplay(): GameplayRecorder | undefined;
  /** LR2-only probe for `finalizeRecordingIfActive` — preserves the historical asymmetry (audit later). */
  isLr2GameplayRecording(): boolean;
  getAutoRecordArmed(): boolean;
  setAutoRecordArmed(value: boolean): void;
  /** Snapshot of the recording filename stem at call time; the demo updates it per chart in `playSong`. */
  getRecordingFilenameBase(): string;
  setStatus(text: string): void;
}

/**
 * Captures the currently-mounted scene as a PNG and triggers a browser download. Mirrors `extract.canvas`'s rect
 * contract carefully because Pixi's internal `frame.copyTo(...)` call expects a real `Rectangle` instance — a plain
 * object literal silently falls back to `getLocalBounds`, which on a transform-reset container yields a zero rect
 * and produces a blank image.
 */
export async function captureScreenshot(deps: RecordingDeps): Promise<void> {
  const app = deps.sceneHost.app;
  if (app.renderer === undefined) {
    deps.setStatus('Screenshot failed: renderer not ready');
    return;
  }
  try {
    const activeScene = deps.sceneHost.getCurrentScene();
    const stageInfo = activeScene?.getStageInfo?.();
    // `extract.canvas` returns Pixi's `ICanvas` (HTMLCanvasElement | OffscreenCanvas
    // union). Demo doesn't depend directly on `pixi.js` so we type it via the runtime
    // duck-type `{ toBlob }` we actually consume below.
    let canvas: { toBlob?: (cb: (blob: Blob | null) => void, type?: string) => void };
    let captureWidth: number;
    let captureHeight: number;
    if (stageInfo !== undefined) {
      // Native skin-size path. Reset the container's fitToStage transform around the
      // extract call; the next tick's fitToStage no-ops on cached screen dims and the
      // user never sees the broken state on the live canvas.
      const { container, width, height } = stageInfo;
      const savedScaleX = container.scale.x;
      const savedScaleY = container.scale.y;
      const savedX = container.x;
      const savedY = container.y;
      container.scale.set(1, 1);
      container.position.set(0, 0);
      try {
        // Frame MUST be an actual `Rectangle` instance — Pixi's `extract.canvas`
        // internally calls `options.frame.copyTo(tempRect)` (see
        // `GenerateTextureSystem.js`'s `generateTexture`). A plain `{x, y, width,
        // height}` literal returns `undefined` from the optional chain there and the
        // code falls through to `getLocalBounds(container)`, which on a transform-reset
        // container yields a zero / negative rect → blank canvas, blob fails to encode,
        // download silently fails. Rectangle is re-exported from `@be-music/player-web`
        // so this package doesn't need a direct `pixi.js` dep.
        canvas = app.renderer.extract.canvas({
          target: container,
          frame: new Rectangle(0, 0, width, height),
          resolution: 1,
        }) as typeof canvas;
      } finally {
        container.scale.set(savedScaleX, savedScaleY);
        container.position.set(savedX, savedY);
      }
      captureWidth = width;
      captureHeight = height;
    } else {
      // Fallback: capture the entire stage at the visible window size. Used when the
      // scene isn't a beatoraja `PixiScene` (= LR2 path today). Same toBlob pipeline.
      canvas = app.renderer.extract.canvas(app.stage) as typeof canvas;
      captureWidth = app.screen.width;
      captureHeight = app.screen.height;
    }
    // Both HTMLCanvasElement and OffscreenCanvas expose `toBlob` in modern browsers.
    // Narrow defensively in case a runtime returns something exotic.
    const toBlob = canvas.toBlob;
    if (typeof toBlob !== 'function') {
      deps.setStatus('Screenshot failed: canvas.toBlob unavailable');
      return;
    }
    const blob = await new Promise<Blob | null>((resolve) => {
      toBlob.call(canvas, (b) => resolve(b), 'image/png');
    });
    if (blob === null) {
      deps.setStatus('Screenshot failed: encoder returned null');
      return;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bms-screenshot-${timestamp}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoke after a short delay — some browsers race the download against immediate
    // revocation. 5s is enough for the download dialog to grab the URL.
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
    deps.setStatus(`Screenshot saved (${captureWidth}×${captureHeight})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.setStatus(`Screenshot failed: ${message}`);
  }
}

/**
 * Toggles the recording state of the active gameplay view, or arms / disarms the "record on next song" auto-flag
 * when no gameplay view is mounted yet (= user pressed Record from song-select). Updates the GUI controller's
 * label / class to reflect the current state.
 */
export async function toggleRecording(deps: RecordingDeps): Promise<void> {
  const gameplay = deps.getActiveGameplay();
  const controller = deps.recordController;
  if (!gameplay) {
    // No chart is playing yet — interpret the click as "arm capture for the next song I pick" so the user can stage
    // recording from the song-select screen without having to hit Record at the precise moment gameplay starts. A
    // second click before picking a song disarms.
    const next = !deps.getAutoRecordArmed();
    deps.setAutoRecordArmed(next);
    if (next) {
      controller?.domElement.classList.add('arming');
      controller?.name('◉ Recording on next song');
      deps.setStatus('Recording armed — pick a song to start capturing');
    } else {
      controller?.domElement.classList.remove('arming');
      controller?.name('● Record');
      deps.setStatus('Recording disarmed');
    }
    return;
  }
  if (gameplay.isRecording()) {
    controller?.disable();
    deps.setStatus('Finalizing recording…');
    try {
      const result = await gameplay.stopRecording();
      if (result) {
        // `MediaRecorder`'s native WebM stream is play-only — post-process the blob to inject `Duration` + `Cues` so
        // external players can seek inside it. Cheap on the typical chart-length take (a few hundred ms for a 1-3
        // minute recording on M-series hardware) and gracefully falls back to the raw blob if the patch fails, so a
        // corrupt take is never silently lost.
        const seekable = await makeWebmSeekable(result.blob);
        const filename = `${deps.getRecordingFilenameBase()}.webm`;
        downloadBlob(seekable, filename);
        const seconds = (result.durationMs / 1000).toFixed(1);
        const sizeMb = (seekable.size / (1024 * 1024)).toFixed(1);
        deps.setStatus(`Saved ${filename} (${seconds}s, ${sizeMb} MB)`);
      }
    } finally {
      controller?.domElement.classList.remove('recording');
      controller?.name('● Record');
      controller?.enable();
    }
    return;
  }
  try {
    gameplay.startRecording();
    controller?.domElement.classList.add('recording');
    controller?.name('■ Stop');
    deps.setStatus('Recording…');
  } catch (error) {
    recordLog.warn('start failed', error);
    deps.setStatus(`Recording unavailable: ${(error as Error).message}`);
  }
}

/**
 * Stop the in-flight recording (if any) before a gameplay-view dispose. Sequencing matters: `MediaRecorder.stop()`
 * waits for a `'stop'` event from its source stream — disposing the gameplay view first kills the AudioContext that
 * feeds it, so the recorder never sees the event and the save never finalizes. Caller-side: invoke this BEFORE
 * disposing the gameplay view.
 *
 * Note (preserved from the original method): only checks the LR2 gameplay view via `isLr2GameplayRecording`, not the
 * beatoraja one — preserves the historical asymmetry. Audit later when consolidating the two recording paths.
 */
export async function finalizeRecordingIfActive(deps: RecordingDeps): Promise<void> {
  if (deps.isLr2GameplayRecording()) {
    await toggleRecording(deps);
  }
}
