/**
 * beatoraja's mark processed note (`PlayerConfig.markprocessednote`): a tap note that was judged but is still drawn
 * takes the skin's processed-note image. A skin without one, and the built-in and LR2 playfields, dim the note
 * instead.
 */

/** How much of its opacity a processed note keeps where no processed image stands in for it. */
export const PROCESSED_NOTE_ALPHA = 0.35;

/** The opacity factor of a tap note: dimmed when the option is on and the note is judged, else untouched. */
export function resolveProcessedNoteAlpha(
  markProcessedNotes: boolean | undefined,
  judged: boolean | undefined,
): number {
  return markProcessedNotes === true && judged === true ? PROCESSED_NOTE_ALPHA : 1;
}
