// The Options dialog's Capture folder at work: what a video recording of a play and a screenshot of the stage
// (`recording-controller.ts`) need of the app, and the state they keep between plays.

import type { RecordingFormat, RecordingQuality } from '@be-music/player-browser/recording';
import { finalizeRecordingIfActive, type GameplayRecorder, type RecordingDeps } from '../recording-controller.ts';
import { parseRecordingFormatKey, parseRecordingQuality } from '../recording-format-choice.ts';

export interface RecordingServiceOptions {
  /** The scene host a screenshot is taken from. */
  readonly sceneHost: RecordingDeps['sceneHost'];
  /** The recorder of the play (`PlayScene.recording`), on the stage or loading behind a decide screen. */
  readonly activeGameplay: () => GameplayRecorder | undefined;
  /** The Capture settings in the Options dialog. */
  readonly settings: {
    readonly recordGameplay: boolean;
    readonly recordingResultSeconds: number;
    readonly recordingFormat: string;
    readonly recordingQuality: string;
  };
  /** Locks the Video format and Video quality controls while a recording runs. */
  readonly setRecordingSettingsLocked?: (locked: boolean) => void;
  readonly setStatus: (text: string) => void;
}

/** Settings and lifecycle for play videos and screenshots. */
export class RecordingService {
  /**
   * Filename base for the next saved recording. Derived from the currently-playing song's title (sanitized for
   * filesystem safety) or `gameplay-<timestamp>` when no song info is available. Updated on every `playChart` so
   * back-to-back recordings don't overwrite each other in the user's downloads folder.
   *
   * Read when assembling the download filename; updated in
   * `playChart` / `preloadGameplay` as each chart starts.
   */
  private recordingFilenameBase = 'gameplay';
  private readonly sceneHost: RecordingServiceOptions['sceneHost'];
  private readonly activeGameplay: RecordingServiceOptions['activeGameplay'];
  private readonly settings: RecordingServiceOptions['settings'];
  private readonly setStatus: RecordingServiceOptions['setStatus'];
  private readonly setRecordingSettingsLocked: RecordingServiceOptions['setRecordingSettingsLocked'];

  public constructor(options: RecordingServiceOptions) {
    this.sceneHost = options.sceneHost;
    this.activeGameplay = options.activeGameplay;
    this.settings = options.settings;
    this.setStatus = options.setStatus;
    this.setRecordingSettingsLocked = options.setRecordingSettingsLocked;
  }

  /** Names the next recording after the chart about to play. */
  public setFilenameBase(base: string): void {
    this.recordingFilenameBase = base;
  }

  public prepareResult(gameplay: GameplayRecorder): ((entranceMs: number) => Promise<void>) | undefined {
    if (!gameplay.isRecording()) return undefined;
    const filenameBase = this.recordingFilenameBase;
    const holdMs = this.settings.recordingResultSeconds * 1_000;
    const deps = this.deps();
    return async (entranceMs) => {
      const fadeMs = 350;
      const fadeWindowMs = fadeMs + 50;
      if (holdMs >= fadeWindowMs && gameplay.fadeOutRecording) {
        await new Promise<void>((resolve) => setTimeout(resolve, entranceMs + holdMs - fadeWindowMs));
        gameplay.fadeOutRecording(fadeMs);
        await new Promise<void>((resolve) => setTimeout(resolve, fadeWindowMs));
      } else {
        await new Promise<void>((resolve) => setTimeout(resolve, entranceMs + holdMs));
      }
      await finalizeRecordingIfActive(deps, gameplay, filenameBase);
    };
  }

  /** The container and codec the Options dialog's "Video format" asks recordings to be written in. */
  private get recordingFormat(): RecordingFormat {
    return parseRecordingFormatKey(this.settings.recordingFormat);
  }

  /**
   * Bundle the player's recording-related fields into the `RecordingDeps` shape that
   * `recording-controller.ts` consumes. Built as a getter-based bundle (rather than a structural copy of `this`) so
   * `RecordingDeps` can stay an interface of getter / setter functions — TypeScript otherwise refuses to satisfy a
   * structural `RecordingHost` from a class whose backing fields are `private`. Cheap to allocate per call; called at
   * most a handful of times per session (record toggle / screenshot / chart-end recording finalize).
   */
  public deps(): RecordingDeps {
    return {
      sceneHost: this.sceneHost,
      getActiveGameplay: () => this.activeGameplay(),
      getRecordGameplay: () => this.settings.recordGameplay,
      getRecordingFilenameBase: () => this.recordingFilenameBase,
      getRecordingFormat: () => this.recordingFormat,
      getRecordingQuality: (): RecordingQuality => parseRecordingQuality(this.settings.recordingQuality),
      ...(this.setRecordingSettingsLocked !== undefined
        ? { setRecordingSettingsLocked: this.setRecordingSettingsLocked }
        : {}),
      setStatus: (text) => this.setStatus(text),
    };
  }
}
