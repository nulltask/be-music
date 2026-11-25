import type { PixiSceneHost } from '@be-music/player-browser/host';
import { Rectangle, logger } from '@be-music/player-browser';
import {
  downloadBlob,
  makeWebMSeekable,
  recordingFileExtension,
  type RecordingFormat,
  type RecordingQuality,
} from '@be-music/player-browser/recording';

const recordLog = logger('record');

/**
 * Common recording-API surface both gameplay paths (a built-in or LR2 play scene's `recording` and beatoraja's
 * `PixiBeatorajaGameplayView`) expose. Narrowed type so {@link activeGameplayRecorder} can return a path-agnostic value the rest of the controller
 * acts on without branching by family.
 */
export interface GameplayRecorder {
  startRecording(options?: { format?: RecordingFormat; quality?: RecordingQuality }): void;
  stopRecording(): Promise<{ blob: Blob; mimeType: string; durationMs: number; seekable: boolean } | undefined>;
  isRecording(): boolean;
  fadeOutRecording?(durationMs: number): void;
}

/**
 * Dependencies the recording controller's free functions read from / write to. Modelled as explicit getters /
 * setters / callbacks (rather than `this` references) so the player class can pass them in without having to drop its
 * private modifier on every backing field. Each call site builds one of these from the player's recording service — see
 * `RecordingService.deps` in `services/recording.ts`.
 */
export interface RecordingDeps {
  readonly sceneHost: PixiSceneHost;
  /** Whichever gameplay view is mounted right now, or `undefined` when neither family is active. */
  getActiveGameplay(): GameplayRecorder | undefined;
  getRecordGameplay(): boolean;
  /** Snapshot of the recording filename stem at call time; the player updates it per chart in `playChart`. */
  getRecordingFilenameBase(): string;
  /** The Options dialog's "Video format": the container and codec a new recording is written in. */
  getRecordingFormat(): RecordingFormat;
  /** The Options dialog's "Video quality": the bitrates a new recording is made at. */
  getRecordingQuality(): RecordingQuality;
  /** Disables the Video format and Video quality controls while a recording runs: they apply when one starts. */
  setRecordingSettingsLocked?(locked: boolean): void;
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
    // union). Player doesn't depend directly on `pixi.js` so we type it via the runtime
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
      // Remove viewport magnification while preserving the skin's output pixel aspect (classic LR2 coordinates
      // may be stretched to widescreen). Resetting both axes to 1 would squeeze exported screenshots back to 4:3.
      const pixelAspect = savedScaleX / savedScaleY;
      const outputWidth =
        Number.isFinite(pixelAspect) && pixelAspect > 0 ? Math.max(1, Math.round(width * pixelAspect)) : width;
      container.scale.set(1, 1);
      container.position.set(0, 0);
      try {
        // Frame MUST be an actual `Rectangle` instance — Pixi's `extract.canvas`
        // internally calls `options.frame.copyTo(tempRect)` (see
        // `GenerateTextureSystem.js`'s `generateTexture`). A plain `{x, y, width,
        // height}` literal returns `undefined` from the optional chain there and the
        // code falls through to `getLocalBounds(container)`, which on a transform-reset
        // container yields a zero / negative rect → blank canvas, blob fails to encode,
        // download silently fails. Rectangle is re-exported from `@be-music/player-browser`
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
      // Pixi extraction ignores the target's root transform. Stretch the extracted source canvas instead of
      // enlarging its frame, which would leave the extra columns transparent.
      if (outputWidth !== width) {
        const output = document.createElement('canvas');
        output.width = outputWidth;
        output.height = height;
        const context = output.getContext('2d');
        if (context === null) throw new Error('2D canvas unavailable');
        context.imageSmoothingEnabled = false;
        context.drawImage(canvas as unknown as CanvasImageSource, 0, 0, outputWidth, height);
        canvas = output;
      }
      captureWidth = outputWidth;
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
/** Stops and downloads one take before its audio graph is disposed. */
export async function finalizeRecordingIfActive(
  deps: RecordingDeps,
  gameplay = deps.getActiveGameplay(),
  filenameBase = deps.getRecordingFilenameBase(),
): Promise<void> {
  if (gameplay === undefined) return;
  try {
    const result = gameplay.isRecording() ? await gameplay.stopRecording() : undefined;
    if (!result) return;
    const blob = result.seekable ? result.blob : await makeWebMSeekable(result.blob);
    const filename = `${filenameBase}.${recordingFileExtension(result.mimeType)}`;
    downloadBlob(blob, filename);
    deps.setStatus(`Saved ${filename}`);
  } catch (error) {
    recordLog.warn('save failed', error);
    deps.setStatus(`Recording could not be saved: ${String(error)}`);
  } finally {
    deps.setRecordingSettingsLocked?.(false);
  }
}

/** Starts a fresh capture once the play's audio is ready. The setting applies to every play. */
export function startAutomaticRecording(deps: RecordingDeps): void {
  if (!deps.getRecordGameplay()) return;
  const gameplay = deps.getActiveGameplay();
  if (!gameplay || gameplay.isRecording()) return;
  try {
    gameplay.startRecording({ format: deps.getRecordingFormat(), quality: deps.getRecordingQuality() });
    deps.setRecordingSettingsLocked?.(true);
    deps.setStatus('Recording…');
  } catch (error) {
    recordLog.warn('auto-start failed', error);
    deps.setStatus(`Recording unavailable: ${String(error instanceof Error ? error.message : error)}`);
  }
}
