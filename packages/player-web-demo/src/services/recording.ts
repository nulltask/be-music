// The Debug Menu's Capture folder at work: what a video recording of a play and a screenshot of the stage
// (`recording-controller.ts`) need of the app, and the state they keep between plays.

import type { RecordingFormat } from '@be-music/player-web/recording';
import type { GameplayRecorder, RecordingDeps } from '../recording-controller.ts';
import { parseRecordingFormatKey } from '../recording-format-choice.ts';

export interface RecordingServiceOptions {
  /** The scene host a screenshot is taken from. */
  readonly sceneHost: RecordingDeps['sceneHost'];
  /** The Debug Menu's record button (`DebugMenu.recordController`), once the menu is built. */
  readonly recordController: () => RecordingDeps['recordController'];
  /** The recorder of the play (`PlayScene.recording`), on the stage or loading behind a decide screen. */
  readonly activeGameplay: () => GameplayRecorder | undefined;
  /** The state the Debug Menu's "Video format" is kept in. */
  readonly settings: { readonly recordingFormat: string };
  readonly setStatus: (text: string) => void;
}

/** A video recording armed on the select screen, the name the next one is saved under, and the format it is made in. */
export class RecordingService {
  /**
   * `true` after the user clicks Record on the song-select screen but before they actually pick a song. Consumed (and
   * cleared) by `startArmedRecording` as the play starts, kicking off `startRecording()` so the very first frame of the
   * chart is captured.
   *
   * A second click on Record before picking a song flips this back to `false` ("disarm").
   */
  private autoRecordArmed = false;
  /**
   * Filename base for the next saved recording. Derived from the currently-playing song's title (sanitized for
   * filesystem safety) or `gameplay-<timestamp>` when no song info is available. Updated on every `playChart` so
   * back-to-back recordings don't overwrite each other in the user's downloads folder.
   *
   * Read by `toggleRecording` (in `recording-controller.ts`) when assembling the download filename; mutated in
   * `playChart` / `preloadGameplay` as each chart starts.
   */
  private recordingFilenameBase = 'gameplay';
  private readonly sceneHost: RecordingServiceOptions['sceneHost'];
  private readonly recordController: RecordingServiceOptions['recordController'];
  private readonly activeGameplay: RecordingServiceOptions['activeGameplay'];
  private readonly settings: RecordingServiceOptions['settings'];
  private readonly setStatus: RecordingServiceOptions['setStatus'];

  public constructor(options: RecordingServiceOptions) {
    this.sceneHost = options.sceneHost;
    this.recordController = options.recordController;
    this.activeGameplay = options.activeGameplay;
    this.settings = options.settings;
    this.setStatus = options.setStatus;
  }

  /** Names the next recording after the chart about to play. */
  public setFilenameBase(base: string): void {
    this.recordingFilenameBase = base;
  }

  /** The container and codec the Debug Menu's "Video format" asks recordings to be written in. */
  private get recordingFormat(): RecordingFormat {
    return parseRecordingFormatKey(this.settings.recordingFormat);
  }

  /**
   * Bundle the demo's recording-related fields into the `RecordingDeps` shape that
   * `recording-controller.ts` consumes. Built as a getter-based bundle (rather than a structural copy of `this`) so
   * `RecordingDeps` can stay an interface of getter / setter functions — TypeScript otherwise refuses to satisfy a
   * structural `RecordingHost` from a class whose backing fields are `private`. Cheap to allocate per call; called at
   * most a handful of times per session (record toggle / screenshot / chart-end recording finalize).
   */
  public deps(): RecordingDeps {
    return {
      sceneHost: this.sceneHost,
      recordController: this.recordController(),
      getActiveGameplay: () => this.activeGameplay(),
      getAutoRecordArmed: () => this.autoRecordArmed,
      setAutoRecordArmed: (value) => {
        this.autoRecordArmed = value;
      },
      getRecordingFilenameBase: () => this.recordingFilenameBase,
      getRecordingFormat: () => this.recordingFormat,
      setStatus: (text) => this.setStatus(text),
    };
  }
}
