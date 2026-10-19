import type { CourseView } from '@be-music/scene-model';
import { resolveBeatorajaCourseText } from './course.ts';
import {
  resolveBeatorajaSkinText,
  resolveBeatorajaSongText,
  type BeatorajaSkinTextInput,
  type BeatorajaSongTextInput,
} from './song-text.ts';

/** What a play skin's texts read. */
export interface BeatorajaPlayTextInput {
  /** The chart being played. */
  readonly song?: BeatorajaSongTextInput;
  readonly skin?: BeatorajaSkinTextInput;
  /** The running course, when the play is one of its stages. */
  readonly course?: CourseView;
}

/**
 * A play skin's text (`text[].ref`): the running course's stage titles (150-159), the chart's song texts and the
 * skin's own; `undefined` for another id.
 */
export function resolveBeatorajaPlayText(id: number, input: BeatorajaPlayTextInput): string | undefined {
  if (input.course !== undefined) {
    const courseText = resolveBeatorajaCourseText(id, input.course);
    if (courseText !== undefined) return courseText;
  }
  return resolveBeatorajaSongText(id, input.song) ?? resolveBeatorajaSkinText(id, input.skin);
}
