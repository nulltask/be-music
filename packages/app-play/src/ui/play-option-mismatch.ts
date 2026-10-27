// The dialog a play opens when the selected play options do not fit its chart (`PlayOptionMismatchError`): beatoraja
// CONVERGE on a 7KEY chart, LR2 SCATTER on a non-9KEY chart, SP TO DP on a bmson chart, ... It names the options, and
// the player goes back to the select screen when it closes.

/** Lists the selected `options` the chart cannot be played with; `onClose` runs once the player dismisses the dialog. */
export function showPlayOptionMismatch(options: readonly string[], onClose: () => void): void {
  const dialog = document.querySelector<HTMLDialogElement>('#play-option-mismatch');
  if (dialog === null) {
    onClose();
    return;
  }
  const list = dialog.querySelector('[data-play-option-mismatch-list]');
  if (list !== null) {
    list.replaceChildren(
      ...options.map((option) => {
        const item = document.createElement('li');
        item.textContent = option;
        return item;
      }),
    );
  }
  // The dialog owns keyboard navigation; its keys must not reach the player's shortcuts.
  dialog.onkeydown = (event) => event.stopPropagation();
  // A dialog already open keeps the close it was shown with.
  if (dialog.open) return;
  dialog.addEventListener('close', onClose, { once: true });
  dialog.showModal();
}
