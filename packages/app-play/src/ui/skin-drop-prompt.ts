import type { SkinFamilyId } from '@be-music/player-browser/skin';

// The "Drop a skin" prompt the Debug Menu's Skin system picker opens for a skin system with no skin loaded.

/** The skin systems the prompt asks a drop for. */
export type SkinDropFamily = 'lr2' | 'beatoraja';

/**
 * Asks for a drop of a skin of `family`, picked in the Debug Menu with none loaded: a drop-card-like prompt that any
 * drop closes. The detected skin is confirmed separately before it is used.
 *
 * `setPending` keeps the request for the drop to answer: `family` as the prompt opens, `undefined` when it is
 * withdrawn.
 */
export function promptSkinDrop(family: SkinDropFamily, setPending: (family: SkinDropFamily | undefined) => void): void {
  const dialog = document.querySelector<HTMLDialogElement>('#skin-drop');
  if (dialog === null) return;
  setPending(family);
  const title = dialog.querySelector('h2');
  const hint = dialog.querySelector('[data-skin-drop-hint]');
  if (title !== null) title.textContent = family === 'lr2' ? 'Drop an LR2 skin' : 'Drop a beatoraja skin';
  if (hint !== null) {
    hint.innerHTML =
      family === 'lr2'
        ? 'Drop the folder that holds your LR2 theme (<code>LR2files/Theme/…</code>, with its <code>.lr2skin</code> files).'
        : 'Drop the folder that holds your beatoraja skin (its <code>.luaskin</code> or <code>.json</code> skin files).';
  }
  // Cancel or Escape withdraws the request; a drop closes the prompt but keeps it, for the drop to answer.
  const withdraw = () => {
    setPending(undefined);
  };
  dialog.oncancel = withdraw;
  const cancel = dialog.querySelector<HTMLButtonElement>('[data-skin-drop-cancel]');
  if (cancel !== null) {
    cancel.onclick = () => {
      withdraw();
      dialog.close();
    };
  }
  if (!dialog.open) dialog.showModal();
}

/** Confirms a detected skin before loading can replace the current theme's assets. */
export function confirmSkinDrop(
  families: ReadonlySet<SkinFamilyId>,
  preferred?: SkinDropFamily,
): Promise<SkinDropFamily | undefined> {
  if (!families.has('lr2') && !families.has('beatoraja')) return Promise.resolve(undefined);
  const dialog = document.querySelector<HTMLDialogElement>('#skin-switch');
  if (dialog === null || dialog.open) return Promise.resolve(undefined);
  const buttons = dialog.querySelectorAll<HTMLButtonElement>('[data-skin-family]');
  for (const button of buttons) {
    const family = button.dataset.skinFamily as SkinDropFamily;
    button.hidden = !families.has(family);
  }
  dialog.returnValue = '';
  // The dialog owns keyboard navigation; its keys must not reach the player's shortcuts.
  dialog.onkeydown = (event) => event.stopPropagation();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        const family = dialog.returnValue;
        resolve((family === 'lr2' || family === 'beatoraja') && families.has(family) ? family : undefined);
      },
      { once: true },
    );
    dialog.showModal();
    if (preferred !== undefined && families.has(preferred)) {
      dialog.querySelector<HTMLButtonElement>(`[data-skin-family="${preferred}"]`)?.focus();
    }
  });
}
