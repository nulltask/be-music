/**
 * The select screen's README dialog, the same for every skin family: `<be-music-readme-dialog>` from
 * `@be-music/player-ui`, laid over the stage in the host's DOM layer. The session decides when it shows and with what
 * texts (`SelectFrame`'s `readText`); the dialog shows the one selected, with a tab for each of the folder's text files
 * when there are several, scrolls it for the keys, and asks to close (its close button, Escape, a click on the backdrop)
 * or for another tab, which the view turns into `readtext` and `readtext-tab` intents.
 */

import { defineBeMusicElements, type BeMusicReadmeDialogElement, type BeMusicUIEvent } from '@be-music/player-ui';
import { basecoatTheme } from '@be-music/player-ui/themes/basecoat';
import type { SelectFrame } from '../types.ts';

/** The README dialog of one select view. See the module comment. */
export class SelectReadmeDialog {
  private element: BeMusicReadmeDialogElement | undefined;
  private shown: SelectFrame['readText'];
  /** Where the dialog goes (the host's DOM layer), while the view is attached. */
  private parent: (() => HTMLElement) | undefined;
  private requestClose: () => void = () => {};
  private requestTab: (index: number) => void = () => {};

  /** Whether the dialog is showing a text. */
  public get open(): boolean {
    return this.shown !== undefined;
  }

  /**
   * Lets the dialog show in `parent` (the host's DOM layer, read only once a text shows); `requestClose` runs when the
   * player asks to close it, and `requestTab` when they choose another of its text files.
   */
  public attach(parent: () => HTMLElement, requestClose: () => void, requestTab: (index: number) => void): void {
    this.parent = parent;
    this.requestClose = requestClose;
    this.requestTab = requestTab;
  }

  /** Shows the selected text, from its top each time it is opened or switched to; `undefined` closes the dialog. */
  public show(readText: SelectFrame['readText']): void {
    if (readText === this.shown) return;
    const element = readText === undefined ? this.element : this.mount();
    if (element === undefined) return;
    this.shown = readText;
    element.subheading =
      readText === undefined ? '' : [readText.chart.title, readText.chart.subtitle].filter(Boolean).join(' ');
    element.tabs = readText?.files.map((file) => file.name) ?? [];
    element.selectedTab = readText?.selected ?? 0;
    element.text = readText?.files[readText.selected]?.text;
  }

  /** Scrolls the text by `delta` CSS pixels (positive: down), stopping at either end. */
  public scrollBy(delta: number): void {
    this.element?.scrollTextBy(delta);
  }

  /** Takes the dialog out of the page (closing it); it shows the session's text again on the next {@link show}. */
  public detach(): void {
    this.parent = undefined;
    this.requestClose = () => {};
    this.requestTab = () => {};
    this.shown = undefined;
    if (this.element !== undefined) {
      this.element.text = undefined;
      this.element.remove();
    }
  }

  /** The dialog element in the host's DOM layer, made on the first text shown. */
  private mount(): BeMusicReadmeDialogElement | undefined {
    const parent = this.parent?.();
    if (parent === undefined) return undefined;
    let element = this.element;
    if (element === undefined) {
      const registry = parent.ownerDocument.defaultView?.customElements;
      if (registry === undefined) return undefined;
      defineBeMusicElements(registry, { theme: basecoatTheme });
      element = parent.ownerDocument.createElement('be-music-readme-dialog');
      element.addEventListener('readme-close', () => this.requestClose());
      element.addEventListener('readme-tab', (event) =>
        this.requestTab((event as BeMusicUIEvent<'readme-tab'>).detail.index),
      );
      this.element = element;
    }
    if (element.parentElement !== parent) parent.append(element);
    return element;
  }
}
