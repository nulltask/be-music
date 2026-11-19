import { html, type TemplateResult } from 'lit';

// Keyboard shortcuts for the buttons of the player's modal dialogs, shown on the buttons themselves: Cmd+Enter (Ctrl+Enter
// off a Mac) presses a dialog's primary button, Escape its cancel button, and a letter any other button. A letter is the
// initial of the button's English label and stays the same in every language, so the keys do not move when the language
// changes. A button takes part through `data-dialog-shortcut` (`primary`, `cancel` or its letter); `dialogShortcutHint`
// draws the keys inside it.

/** The letter keys a dialog's other buttons are pressed with. */
export type DialogShortcutLetter =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z';

/** The buttons a dialog shortcut presses: the primary one, the cancel one, or the one a letter names. */
export type DialogShortcut = 'primary' | 'cancel' | DialogShortcutLetter;

/** The parts of a key press a dialog shortcut reads. */
export interface DialogShortcutKey {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing?: boolean;
}

/** Whether `platform` (`navigator.userAgentData.platform` or `navigator.platform`) names a Mac or an iPad. */
export function isApplePlatform(platform: string | undefined): boolean {
  return platform !== undefined && /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * The dialog button a key press presses: Cmd+Enter (Ctrl+Enter off Apple devices) the primary, Escape the cancel, and a
 * plain letter the button it names. A letter is left to the field being typed in (`typing`).
 */
export function dialogShortcutOf(
  event: DialogShortcutKey,
  apple: boolean,
  typing: boolean = false,
): DialogShortcut | undefined {
  if (event.isComposing === true || event.altKey || event.shiftKey) return undefined;
  if (event.key === 'Escape') return event.metaKey || event.ctrlKey ? undefined : 'cancel';
  if (/^[a-z]$/i.test(event.key))
    return typing || event.metaKey || event.ctrlKey ? undefined : (event.key.toLowerCase() as DialogShortcutLetter);
  if (event.key !== 'Enter') return undefined;
  const modifier = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return modifier ? 'primary' : undefined;
}

/** The key caps a dialog shortcut is drawn with. */
export function dialogShortcutKeys(shortcut: DialogShortcut, apple: boolean): readonly string[] {
  if (shortcut === 'cancel') return ['Esc'];
  if (shortcut === 'primary') return apple ? ['⌘', '↵'] : ['Ctrl', '↵'];
  return [shortcut.toUpperCase()];
}

/** The shortcut as `aria-keyshortcuts` names it. */
export function dialogShortcutAria(shortcut: DialogShortcut, apple: boolean = applePlatform()): string {
  if (shortcut === 'cancel') return 'Escape';
  if (shortcut === 'primary') return apple ? 'Meta+Enter' : 'Control+Enter';
  return shortcut.toUpperCase();
}

/** The key caps drawn inside a dialog button; hidden from assistive technology, which reads `aria-keyshortcuts`. */
export function dialogShortcutHint(shortcut: DialogShortcut, apple: boolean = applePlatform()): TemplateResult {
  return html`<span class="dialog-shortcut" aria-hidden="true"
    >${dialogShortcutKeys(shortcut, apple).map((key) => html`<kbd>${key}</kbd>`)}</span
  >`;
}

function applePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const hinted = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  return isApplePlatform(hinted !== undefined && hinted !== '' ? hinted : navigator.platform);
}

/** The button of `dialog` a shortcut presses: shown and enabled. */
function shortcutButton(dialog: HTMLDialogElement, shortcut: DialogShortcut): HTMLButtonElement | undefined {
  for (const button of dialog.querySelectorAll<HTMLButtonElement>(`button[data-dialog-shortcut="${shortcut}"]`)) {
    if (button.closest('dialog') !== dialog || button.disabled || button.closest('[hidden]') !== null) continue;
    return button;
  }
  return undefined;
}

/** Whether a key press lands in a field that takes letters: a text input, a text area, a select or editable text. */
function isTyping(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0];
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)
    return true;
  return (
    target instanceof HTMLInputElement &&
    !['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'].includes(target.type)
  );
}

/** The modal dialog a key press is in: the one holding its target, else the last modal one open. */
function modalDialogOf(event: KeyboardEvent): HTMLDialogElement | undefined {
  const target = event.composedPath()[0];
  const holder = target instanceof Element ? target.closest('dialog') : null;
  if (holder !== null && holder.open && holder.matches(':modal')) return holder;
  const open = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((dialog) =>
    dialog.matches(':modal'),
  );
  return open.at(-1);
}

/**
 * Presses the dialog buttons the shortcuts name. It listens on the window in the capture phase, ahead of the dialogs'
 * own key handlers that keep keys from the screens behind them. A key no button of the dialog takes is left alone:
 * Escape on a dialog with no cancel button goes to the browser, which closes it.
 */
export function installDialogShortcuts(): void {
  const apple = applePlatform();
  window.addEventListener(
    'keydown',
    (event) => {
      const shortcut = dialogShortcutOf(event, apple, isTyping(event));
      if (shortcut === undefined || event.defaultPrevented) return;
      const dialog = modalDialogOf(event);
      if (dialog === undefined) return;
      const button = shortcutButton(dialog, shortcut);
      if (button === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      button.click();
    },
    { capture: true },
  );
}
