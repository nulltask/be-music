/**
 * The beatoraja select view's search prompt (`BeatorajaSelectView`): drawn over the skin while a search is applied, with
 * the number of matches, so the search shows on skins that author no search word text. The host's text field does the
 * typing and the select session filters the list (the browse model's search); the prompt only shows the result.
 *
 * The prompt reads the view's state through {@link BeatorajaSelectSearchContext}; the select view passes it.
 */

import { normalizeSearchQuery, type LibraryEntry } from '@be-music/player-scene-model';
import { Text } from 'pixi.js';
import type { BeatorajaPlaySkinView } from '../skin-view.ts';

/** What the search prompt reads on the select view: its fields of these names. */
export interface BeatorajaSelectSearchContext {
  /** The skin's view: the prompt is drawn into its container, centred on its canvas. */
  readonly view: Pick<BeatorajaPlaySkinView, 'width' | 'container'>;
  readonly entries: ReadonlyArray<LibraryEntry>;
  /** The search as typed. */
  readonly searchQuery: string;
}

/** The search prompt. See the module comment. */
export class BeatorajaSelectSearch {
  private readonly ctx: BeatorajaSelectSearchContext;

  /** The prompt's text, mounted on the first search. */
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

  /**
   * Shows, updates or hides the prompt. Mounted inside the skin's container so it scales with the rest of the chrome.
   * Shown while a search is applied (a text of spaces searches nothing); the search word text the skin authors
   * (`BEATORAJA_TEXT.SEARCHWORD`) is the canonical surface, the prompt gives the match count on skins without it.
   */
  refreshSearchPrompt(): void {
    const query = this.ctx.searchQuery;
    if (normalizeSearchQuery(query).length === 0) {
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
    // "No matches" when the query lists nothing, so the player sees they typed too narrowly; otherwise the count, which
    // doubles as a hint that the filter is on.
    const count = this.ctx.entries.length;
    const suffix = count === 0 ? ' — no matches' : ` — ${count} match${count === 1 ? '' : 'es'}`;
    this.searchPromptText.text = `🔍 ${query}${suffix}`;
    this.searchPromptText.tint = count === 0 ? 0xff8888 : 0xffe066;
    this.searchPromptText.visible = true;
  }
}
