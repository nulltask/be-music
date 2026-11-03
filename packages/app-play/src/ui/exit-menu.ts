// The exit menu (`#exit-menu`): Escape at the root of the select screen asks whether to leave it for the drop screen,
// as That-Which-Must-Not-Be-Named PC's exit menu asks before it leaves, rather than leaving at once (beatoraja) or doing
// nothing (LR2). The dialog's buttons answer it; Escape and Cancel stay on the select screen.

/** What the player picked in the exit menu. */
export type ExitMenuChoice = 'leave' | 'cancel';

/** The choice a closed exit menu's `returnValue` names: Leave only when its button closed it. */
export function exitMenuChoice(returnValue: string): ExitMenuChoice {
  return returnValue === 'leave' ? 'leave' : 'cancel';
}

/** Opens the exit menu and calls `onChoice` once with what the player picked. A menu already open is left as it is. */
export function showExitMenu(onChoice: (choice: ExitMenuChoice) => void): void {
  const dialog = document.querySelector<HTMLDialogElement>('#exit-menu');
  if (dialog === null || dialog.open) return;
  dialog.returnValue = '';
  // The dialog owns keyboard navigation; its keys must not reach the select screen behind it.
  dialog.onkeydown = (event) => event.stopPropagation();
  dialog.addEventListener('close', () => onChoice(exitMenuChoice(dialog.returnValue)), { once: true });
  dialog.showModal();
}
