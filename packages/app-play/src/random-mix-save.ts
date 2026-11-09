// Keeping a RANDOM MIX run once it is over: what the run was started with, the course it played, and how the save
// dialog's answer turns it into one of the player's own courses (`CourseMaker.saveRandomMix`). The dialog itself is
// `ui/random-mix-save-dialog.ts`; these decisions are kept apart from it so they can be tested.

import type {
  CourseDefinition,
  LR2RandomMixSettings,
  NonstopConnection,
  RandomMixConditions,
} from '@be-music/player-engine/course';
import { resolveCourseView, type CourseView, type LibraryCourse } from '@be-music/player-scene-model';

/** What a RANDOM MIX run was started with: the RANDOM MIX dialog's conditions and draw settings, as confirmed. */
export interface RandomMixSetup {
  kind: 'expert' | 'nonstop';
  /** The conditions, with the stage count the draw took (`resolveRandomMixCount`). */
  conditions: RandomMixConditions;
  settings: LR2RandomMixSettings;
  /** The connection after every stage of a NONSTOP mix. */
  defaultConnection: NonstopConnection;
}

/** A RANDOM MIX run being played: its setup, and the draw kept as its folder's newest course (absent when endless). */
export interface RandomMixRun {
  setup: RandomMixSetup;
  kept?: CourseDefinition;
}

/** What the save dialog is opened with. */
export interface RandomMixSaveRequest {
  setup: RandomMixSetup;
  /** The run's course as the skins show it: the stages drawn, in order. */
  course: CourseView;
  /** When the run ended: the name the dialog offers. */
  endedAt: Date;
}

/** A RANDOM MIX run that is over, waiting for the save dialog: what it shows, and the course a save keeps. */
export interface FinishedRandomMix {
  request: RandomMixSaveRequest;
  /** The course to save: the kept draw (renamed), or the run's own course when it was not kept. */
  course: CourseDefinition;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** The name the save dialog offers: the local date and time the run ended, `YYYY-MM-DD HH:mm`. */
export function formatRandomMixSaveName(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * A RANDOM MIX run that is over, as the save dialog takes it: `course` is the run's course bar as it was played (an
 * endless run's settled to the stages it played), whose stages the dialog lists, all of them however far the run got.
 */
export function finishRandomMix(run: RandomMixRun, course: LibraryCourse, endedAt: Date): FinishedRandomMix {
  return {
    request: { setup: run.setup, course: resolveCourseView(course), endedAt },
    course: run.kept ?? course.definition,
  };
}

/** Saves a finished RANDOM MIX under `name` (the offered name when blank) as a course of the player's own. */
export function saveFinishedRandomMix(
  maker: { saveRandomMix(course: CourseDefinition, name: string): CourseDefinition },
  finished: FinishedRandomMix,
  name: string,
): CourseDefinition {
  return maker.saveRandomMix(finished.course, name.trim() || formatRandomMixSaveName(finished.request.endedAt));
}
