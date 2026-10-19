// The demo's play logs: the app named as their recorder, and "Auto-save play history": a play's play log
// (`*.bmplay.json`, an input replay), or a course's (`*.bmcourse.json`), downloaded the moment its result shows.

import {
  resolveCoursePlaylogFilename,
  resolvePlaylogFilename,
  serializeCoursePlaylog,
  serializePlaylog,
  type BeMusicCoursePlaylog,
  type BeMusicPlaylog,
  type PlaylogRecorderInfo,
} from '@be-music/player/playlog';
import demoPackageJson from '../../package.json' with { type: 'json' };

/** This app as the recorder of its play-logs (`recorder` in `*.bmplay.json`); the engine adds its own version. */
export const PLAYLOG_RECORDER: Omit<PlaylogRecorderInfo, 'engine'> = {
  name: 'be-music-web',
  version: demoPackageJson.version,
  ...(__BE_MUSIC_BUILD__.length > 0 ? { build: __BE_MUSIC_BUILD__ } : {}),
  platform: 'web',
};

export interface PlaylogAutoSaveOptions {
  /** Saves `blob` under `filename` (`downloadBlob`). */
  readonly download: (blob: Blob, filename: string) => void;
  /** A save that failed; the result screen goes on. */
  readonly warn: (message: string, error: unknown) => void;
}

/**
 * Saves play logs by the "Auto-save play history" setting as it was when the play started (`latch`): the checkbox is
 * disabled during a play, so a change can only come between plays, and it applies from the next one. A course's log is
 * saved by the value latched for its last stage played (a NONSTOP run is one play), the same as that stage's own log.
 */
export class PlaylogAutoSave {
  private latched = false;
  private readonly download: (blob: Blob, filename: string) => void;
  private readonly warn: (message: string, error: unknown) => void;

  public constructor(options: PlaylogAutoSaveOptions) {
    this.download = options.download;
    this.warn = options.warn;
  }

  /** Whether the play in flight, or the last one, saves its log. */
  public get enabled(): boolean {
    return this.latched;
  }

  /** Takes the setting for the play that is about to start. */
  public latch(enabled: boolean): void {
    this.latched = enabled;
  }

  /**
   * Downloads a play's log when the setting was on at its start. Failures are non-fatal — the result screen must never
   * be blocked by a download hiccup.
   */
  public savePlay(playlog: BeMusicPlaylog | undefined): void {
    if (!this.latched || playlog === undefined) return;
    try {
      const blob = new Blob([serializePlaylog(playlog)], { type: 'application/json' });
      this.download(blob, resolvePlaylogFilename(playlog));
    } catch (error) {
      this.warn('play-log auto-save failed', error);
    }
  }

  /** Downloads a course run's log (`<course>-<timestamp>.bmcourse.json`) when the setting was on at its last stage's start. */
  public saveCourse(courseLog: BeMusicCoursePlaylog): void {
    if (!this.latched) return;
    try {
      const blob = new Blob([serializeCoursePlaylog(courseLog)], { type: 'application/json' });
      this.download(blob, resolveCoursePlaylogFilename(courseLog));
    } catch (error) {
      this.warn('course play-log auto-save failed', error);
    }
  }
}
