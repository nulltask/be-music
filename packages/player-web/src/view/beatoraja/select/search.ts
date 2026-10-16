/**
 * The beatoraja select scene's search input (`PixiBeatorajaSelectScene`): the `/` key mode that types the query key by
 * key (unless the host's own search field does the typing), and the prompt drawn over the skin while a query is typed or
 * applied, with the number of matches. The scene keeps the query and filters its list with the browse model's search
 * (`matchesSearchQuery`).
 *
 * The search reads the scene's state and calls back into it through {@link BeatorajaSelectSearchContext}; the select
 * scene passes it.
 */

import { Text } from 'pixi.js';
import type { BrowserBrowseEntry } from '../../../collection/types.ts';
import type { BeatorajaPlaySkinView } from '../../../scene/beatoraja/skin-view.ts';

/** What the search reads and calls on the select scene: its fields and methods of these names. */
export interface BeatorajaSelectSearchContext {
  /** The skin's view: the prompt is drawn into its container, centred on its canvas. */
  readonly view: Pick<BeatorajaPlaySkinView, 'width' | 'container'>;
  readonly entries: ReadonlyArray<BrowserBrowseEntry>;
  readonly searchQuery: string;
  setSearchQuery(query: string): void;
  moveCursor(delta: number): void;
  setCursor(index: number): void;
}

/** The search input mode and its prompt. See the module comment. */
export class BeatorajaSelectSearch {
  private readonly ctx: BeatorajaSelectSearchContext;

  /**
   * `true` while the user is in search-input mode (after pressing `/`). In this mode
   * keystrokes go to the search query instead of cursor navigation; Enter / Escape exit
   * the mode (Enter keeps the filter, Escape clears + exits). Visual indicator: a small
   * prompt at the top of the canvas (rendered as a transient Text node).
   */
  searchActive = false;
  /** Sprite holding the live search prompt — only mounted while `searchActive`. */
  searchPromptText: Text | undefined;

  constructor(ctx: BeatorajaSelectSearchContext) {
    this.ctx = ctx;
  }

  destroySearchPrompt(): void {
    if (this.searchPromptText === undefined) return;
    if (!this.searchPromptText.destroyed) {
      this.searchPromptText.destroy();
    }
    this.searchPromptText = undefined;
  }

  setSearchActive(active: boolean): void {
    if (this.searchActive === active) return;
    this.searchActive = active;
    this.refreshSearchPrompt();
  }

  /**
   * Field-keystroke handler for search-input mode. ArrowUp/Down still navigate (so the user
   * can type → arrow-pick); Enter commits the filter and exits search mode; Escape clears
   * + exits; Backspace deletes the last char; printable single-character keys append.
   */
  handleSearchKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.setSearchActive(false);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.setSearchActive(false);
      this.ctx.setSearchQuery('');
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      this.ctx.setSearchQuery(this.ctx.searchQuery.slice(0, -1));
      return;
    }
    // Navigation keys still work inside search mode — the user can type a query, then
    // page through the filtered results without exiting input mode. Mirrors the same set
    // the navigation-mode handler exposes so muscle memory carries.
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.ctx.moveCursor(-1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.ctx.moveCursor(1);
      return;
    }
    if (event.key === 'PageUp') {
      event.preventDefault();
      this.ctx.moveCursor(-10);
      return;
    }
    if (event.key === 'PageDown') {
      event.preventDefault();
      this.ctx.moveCursor(10);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      this.ctx.setCursor(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      this.ctx.setCursor(this.ctx.entries.length - 1);
      return;
    }
    // Printable single-character keys append to the query. Filter out chord modifiers
    // (Ctrl/Alt/Meta + letter) — those are typically OS shortcuts the user doesn't want
    // landing in the search query.
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      this.ctx.setSearchQuery(this.ctx.searchQuery + event.key);
    }
  }

  /**
   * Show / hide / update the transient search prompt overlay. Mounted on the listLayer (=
   * inside the scaled skin container) so its position scales with the rest of the chrome.
   * Visible only while {@link searchActive}; the searchword display the skin authors via
   * `BEATORAJA_TEXT.SEARCHWORD` is the canonical surface, but the transient prompt gives
   * the user clear feedback that they're in input mode even on skins that don't author the
   * text node.
   */
  refreshSearchPrompt(): void {
    if (!this.searchActive && this.ctx.searchQuery.length === 0) {
      if (this.searchPromptText !== undefined) {
        this.searchPromptText.visible = false;
      }
      return;
    }
    if (this.searchPromptText === undefined) {
      const text = new Text({
        text: '',
        style: {
          fontFamily: 'sans-serif',
          fontSize: 24,
          fill: 0xffe066,
          fontWeight: '700',
          stroke: { color: 0x000000, width: 4 },
        },
      });
      text.anchor.set(0.5, 0);
      text.x = this.ctx.view.width / 2;
      text.y = 8;
      this.ctx.view.container.addChild(text);
      this.searchPromptText = text;
    }
    const prompt = this.searchActive ? '/ ' : '🔍 ';
    const display = this.ctx.searchQuery.length > 0 ? this.ctx.searchQuery : '(type to search)';
    // Append "no matches" suffix when the query yields zero entries — gives the user clear
    // feedback that they typed too narrowly. Otherwise show the result count for queries
    // with hits ("3 matches"), which doubles as a hint that filtering is working.
    let suffix = '';
    if (this.ctx.searchQuery.length > 0) {
      if (this.ctx.entries.length === 0) {
        suffix = ' — no matches';
      } else {
        suffix = ` — ${this.ctx.entries.length} match${this.ctx.entries.length === 1 ? '' : 'es'}`;
      }
    }
    this.searchPromptText.text = `${prompt}${display}${suffix}`;
    this.searchPromptText.tint = this.ctx.searchQuery.length > 0 && this.ctx.entries.length === 0 ? 0xff8888 : 0xffe066;
    this.searchPromptText.visible = true;
  }
}
