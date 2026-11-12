/**
 * The lanes whose notes the playfield does not draw: the scratch lanes AUTO SCRATCH plays while **Auto scratch notes**
 * is HIDE (AC 34's オートスクラッチ表示), or `undefined` when every note is drawn. Display only: the notes still play,
 * sound and count.
 */
export function resolveHiddenNoteChannels(
  autoScratchNotes: 'SHOW' | 'HIDE' | undefined,
  autoScratchChannels: ReadonlySet<string>,
): ReadonlySet<string> | undefined {
  return autoScratchNotes === 'HIDE' && autoScratchChannels.size > 0 ? autoScratchChannels : undefined;
}
