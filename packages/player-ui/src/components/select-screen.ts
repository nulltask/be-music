import { html, nothing, type CSSResultGroup, type TemplateResult } from 'lit';
import { FrameElement } from '../base.ts';
import type { BeMusicDOMSelectFrame } from '@be-music/player-skin-sdk';
import { screenStyles } from '../styles/screen.ts';

export class BeMusicSelectScreenElement extends FrameElement<BeMusicDOMSelectFrame> {
  static override styles: CSSResultGroup = screenStyles;
  private focusPending = false;
  public focusSearch(): void {
    const search = this.renderRoot.querySelector<HTMLInputElement>('input[type=search]');
    if (search) {
      search.focus();
      search.select();
    } else this.focusPending = true;
  }
  protected override updated(): void {
    if (this.focusPending) {
      this.focusPending = false;
      this.focusSearch();
    }
  }
  protected override render(): TemplateResult | typeof nothing {
    const f = this.frame;
    if (!f) return nothing;
    return html`<section class="screen" part="screen" @pointerdown=${() => this.emit('gesture-request', undefined)}>
      <header>
        <div>
          <p class="eyebrow">Be-Music / Native</p>
          <h1>Collection</h1>
        </div>
        <input
          class="input"
          type="search"
          aria-label="Search charts"
          placeholder="Search title, artist…"
          .value=${f.searchQuery}
          ?disabled=${f.launching}
          @input=${(e: InputEvent) => {
            if (!e.isComposing) this.emit('search-change', { value: (e.currentTarget as HTMLInputElement).value });
          }}
          @compositionend=${(e: CompositionEvent) => this.emit('search-change', { value: (e.currentTarget as HTMLInputElement).value })}
          @keydown=${(e: KeyboardEvent) => {
            if (e.isComposing) return;
            const input = e.currentTarget as HTMLInputElement;
            if (e.key === 'Escape') {
              e.preventDefault();
              input.value = '';
              this.emit('search-change', { value: '' });
              input.blur();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              input.blur();
            }
          }}
        />
      </header>
      <div class="columns">
        <section class="browse">
          <div class="actions">
            <button
              class="btn"
              data-size="sm"
              data-variant="outline"
              ?disabled=${f.launching}
              @click=${() => this.emit('back-request', undefined)}
            >
              Back
            </button>
            <p class="muted">${f.folderLabel ?? 'All folders'}</p>
          </div>
          <be-music-play-options
            .options=${f.playOptions}
            .choices=${f.playOptionChoices}
            .disabled=${f.launching}
          ></be-music-play-options>
          <be-music-chart-list
            exportparts="list,row"
            .entries=${f.entries}
            .selectedIndex=${f.selectedIndex}
            .disabled=${f.launching}
          ></be-music-chart-list>
        </section>
        <be-music-chart-details
          exportparts="panel:details-panel,title:chart-title"
          .entry=${f.entries[f.selectedIndex]}
          .launching=${f.launching}
          .readText=${f.readText}
        ></be-music-chart-details>
      </div>
      <slot></slot>
    </section>`;
  }
}
