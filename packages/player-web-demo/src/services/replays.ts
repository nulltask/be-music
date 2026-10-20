// The demo's replays: the app named as their recorder, and "Auto-save replays": a play's replay
// (`*.bmplay.json`, an input replay), or a course's (`*.bmcourse.json`), downloaded the moment its result shows.

import {
  resolveCourseReplayFilename,
  resolveReplayFilename,
  serializeCourseReplay,
  serializeReplay,
  type BeMusicCourseReplay,
  type BeMusicReplay,
  type ReplayRecorderInfo,
} from '@be-music/player/replay';
import demoPackageJSON from '../../package.json' with { type: 'json' };

/** This app as the recorder of its replays (`recorder` in `*.bmplay.json`); the engine adds its own version. */
export const REPLAY_RECORDER: Omit<ReplayRecorderInfo, 'engine'> = {
  name: 'be-music-web',
  version: demoPackageJSON.version,
  ...(__BE_MUSIC_BUILD__.length > 0 ? { build: __BE_MUSIC_BUILD__ } : {}),
  platform: 'web',
};

export interface ReplayAutoSaveOptions {
  /** Saves `blob` under `filename` (`downloadBlob`). */
  readonly download: (blob: Blob, filename: string) => void;
  /** A save that failed; the result screen goes on. */
  readonly warn: (message: string, error: unknown) => void;
}

/**
 * Saves replays by the "Auto-save replays" setting as it was when the play started (`latch`): the checkbox is
 * disabled during a play, so a change can only come between plays, and it applies from the next one. A course's log is
 * saved by the value latched for its last stage played (a NONSTOP run is one play), the same as that stage's own log.
 */
export class ReplayAutoSave {
  private latched = false;
  private readonly download: (blob: Blob, filename: string) => void;
  private readonly warn: (message: string, error: unknown) => void;

  public constructor(options: ReplayAutoSaveOptions) {
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
  public savePlay(replay: BeMusicReplay | undefined): void {
    if (!this.latched || replay === undefined) return;
    try {
      const blob = new Blob([serializeReplay(replay)], { type: 'application/json' });
      this.download(blob, resolveReplayFilename(replay));
    } catch (error) {
      this.warn('replay auto-save failed', error);
    }
  }

  /** Downloads a course run's log (`<course>-<timestamp>.bmcourse.json`) when the setting was on at its last stage's start. */
  public saveCourse(courseLog: BeMusicCourseReplay): void {
    if (!this.latched) return;
    try {
      const blob = new Blob([serializeCourseReplay(courseLog)], { type: 'application/json' });
      this.download(blob, resolveCourseReplayFilename(courseLog));
    } catch (error) {
      this.warn('course replay auto-save failed', error);
    }
  }
}
