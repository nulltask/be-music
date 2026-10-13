/** A skin family a dropped folder can carry, beyond the built-in be-music skins. */
export type OfferedSkinFamily = 'lr2' | 'beatoraja';

/** What the "apply this skin?" dialog says, and which skins it offers. */
export interface SkinOffer {
  title: string;
  message: string;
  options: Array<{ family: OfferedSkinFamily; label: string }>;
}

const FAMILY_NAMES: Readonly<Record<OfferedSkinFamily, string>> = { lr2: 'LR2', beatoraja: 'beatoraja' };
/** "an LR2 skin", "a beatoraja skin": the article goes by how the name is said. */
const FAMILY_WITH_ARTICLE: Readonly<Record<OfferedSkinFamily, string>> = { lr2: 'an LR2', beatoraja: 'a beatoraja' };

/**
 * The offer to make after a drop that carried skins: undefined when it carried none. LR2 themes are named when the
 * drop's layout gave their names (`LR2files/Theme/<name>/`).
 */
export function describeSkinOffer(
  families: ReadonlySet<string>,
  lr2ThemeNames: readonly string[] = [],
): SkinOffer | undefined {
  const offered = (['beatoraja', 'lr2'] as const).filter((family) => families.has(family));
  if (offered.length === 0) return undefined;
  const named = (family: OfferedSkinFamily) =>
    family === 'lr2' && lr2ThemeNames.length === 1
      ? `the LR2 skin “${lr2ThemeNames[0]}”`
      : `${FAMILY_WITH_ARTICLE[family]} skin`;
  const what = offered.map(named).join(' and ');
  return {
    title: offered.length === 1 ? 'Use this skin?' : 'Use one of these skins?',
    message: `The folder you dropped has ${what}. Play with it instead of the built-in skin?`,
    options: offered.map((family) => ({
      family,
      label: offered.length === 1 ? 'Use skin' : `Use ${FAMILY_NAMES[family]} skin`,
    })),
  };
}

/**
 * Asks with the `#skin-offer` dialog; resolves to the chosen family, or undefined when the player keeps the built-in
 * skin (the "Not now" button, Escape, or a missing dialog).
 */
export function askSkinOffer(offer: SkinOffer): Promise<OfferedSkinFamily | undefined> {
  const dialog = document.querySelector<HTMLDialogElement>('#skin-offer');
  if (dialog === null) return Promise.resolve(undefined);
  const title = dialog.querySelector('h2');
  const message = dialog.querySelector('[data-skin-offer-message]');
  const choices = dialog.querySelector('[data-skin-offer-choices]');
  if (title !== null) title.textContent = offer.title;
  if (message !== null) message.textContent = offer.message;
  return new Promise((resolve) => {
    let chosen: OfferedSkinFamily | undefined;
    choices?.replaceChildren(
      ...offer.options.map((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'account-dialog-primary';
        button.textContent = option.label;
        button.addEventListener('click', () => {
          chosen = option.family;
          dialog.close();
        });
        return button;
      }),
    );
    dialog.querySelector('[data-skin-offer-decline]')?.addEventListener('click', () => dialog.close(), { once: true });
    dialog.addEventListener('close', () => resolve(chosen), { once: true });
    dialog.showModal();
  });
}
