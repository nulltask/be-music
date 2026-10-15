import type { Lr2BarBodyKind, Lr2BarBodySource } from '@be-music/lr2-skin';
import type { BrowserBrowseEntry } from '../../collection/types.ts';

/** The `#SRC_BAR_BODY` kind LR2 draws for a select-list entry. */
function barBodyKind(entry: BrowserBrowseEntry | undefined): Lr2BarBodyKind {
  if (entry?.kind === 'folder') return entry.folder.courses !== undefined ? 'courseFolder' : 'folder';
  if (entry?.kind !== 'course') return 'song';
  // LR2's NEW COURSE bar (body 7, "make a course") and beatoraja's random course (body 9).
  if (entry.course.newCourse === true) return 'courseCreate';
  if (entry.course.random !== undefined) return 'randomCourse';
  return 'course';
}

/**
 * Picks the bar-body sprite definition for a slot (`#SRC_BAR_BODY`): a song bar takes body 0, a folder 1, a folder of
 * courses 6 (else 1), a course 8, a NEW COURSE bar 7 and a random course 9 (each else 8). Anything the skin lacks falls
 * back to the song body, then the first body. A slot with no entry (out of range near the ends of the list) still
 * gets a body, as LR2's rail draws past the end of the list.
 */
export function pickLr2BarBody(
  bodies: ReadonlyArray<Lr2BarBodySource>,
  entry: BrowserBrowseEntry | undefined,
): Lr2BarBodySource | undefined {
  if (bodies.length === 0) return undefined;
  const kind = barBodyKind(entry);
  const fallback: Lr2BarBodyKind | undefined =
    kind === 'courseFolder' ? 'folder' : kind === 'courseCreate' || kind === 'randomCourse' ? 'course' : undefined;
  return (
    bodies.find((body) => body.kind === kind) ??
    (fallback !== undefined ? bodies.find((body) => body.kind === fallback) : undefined) ??
    bodies.find((body) => body.kind === 'song') ??
    bodies[0]
  );
}
