// Where the keyboard goes once a player dialog (Options, Help, the Safari install steps) closes: back to the play, not
// to the button that opened the dialog. A focused header button takes Enter as a click, so Enter on the select screen,
// meant to start the chart, opened the dialog again.

/** The focus target this releases: the document's active element, as far as it can lose focus. */
export interface FocusableDocument {
  readonly activeElement: object | null;
}

/** Takes focus off whatever holds it after a dialog closed (the opener the browser restored it to), so keys reach the play. */
export function returnKeysToPlay(doc: FocusableDocument = document): void {
  const active = doc.activeElement;
  if (active !== null && 'blur' in active && typeof active.blur === 'function') active.blur();
}

/** Calls {@link returnKeysToPlay} every time `dialog` closes. */
export function releaseFocusOnClose(
  dialog: { addEventListener(type: 'close', listener: () => void): void },
  doc: FocusableDocument = document,
): void {
  dialog.addEventListener('close', () => returnKeysToPlay(doc));
}
