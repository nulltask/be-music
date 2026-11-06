/**
 * The select screen's README dialog, the same for every skin family: `<be-music-readme-dialog>` from
 * `@be-music/player-ui`, laid over the stage in the host's DOM layer. The session decides when it shows and with what
 * text (`SelectFrame`'s `readText`); the dialog shows it, scrolls it for the keys, and asks to close (its close button,
 * Escape, a click on the backdrop), which the view turns into a `readtext` intent.
 */

import { defineBeMusicElements, type BeMusicReadmeDialogElement } from '@be-music/player-ui';
import { basecoatTheme } from '@be-music/player-ui/themes/basecoat';
import type { SelectFrame } from '../types.ts';

/** The README dialog of one select view. See the module comment. */
export class SelectReadmeDialog {
  private element: BeMusicReadmeDialogElement | undefined;
  private shown: SelectFrame['readText'];
  /** Where the dialog goes (the host's DOM layer), while the view is attached. */
  private parent: (() => HTMLElement) | undefined;
  private requestClose: () => void = () => {};

  /** Whether the dialog is showing a text. */
  public get open(): boolean {
    return this.shown !== undefined;
  }

  /**
   * Lets the dialog show in `parent` (the host's DOM layer, read only once a text shows); `requestClose` runs when the
   * player asks to close it.
   */
  public attach(parent: () => HTMLElement, requestClose: () => void): void {
    this.parent = parent;
    this.requestClose = requestClose;
  }

  /** Shows a text, from its top each time it is opened; `undefined` closes the dialog. */
  public show(readText: SelectFrame['readText']): void {
    if (readText === this.shown) return;
    const element = readText === undefined ? this.element : this.mount();
    if (element === undefined) return;
    this.shown = readText;
    element.subheading =
      readText === undefined ? '' : [readText.chart.title, readText.chart.subtitle].filter(Boolean).join(' ');
    element.text = readText?.text;
  }

  /** Scrolls the text by `delta` CSS pixels (positive: down), stopping at either end. */
  public scrollBy(delta: number): void {
    this.element?.scrollTextBy(delta);
  }

  /** Takes the dialog out of the page (closing it); it shows the session's text again on the next {@link show}. */
  public detach(): void {
    this.parent = undefined;
    this.requestClose = () => {};
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
      this.element = element;
    }
    if (element.parentElement !== parent) parent.append(element);
    return element;
  }
}
