import {
  html,
  css,
  type CSSResultGroup,
  type PropertyDeclarations,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { browseEntryBadge, browseEntryCount, browseEntryTitle, type LibraryEntry } from '@be-music/player-skin-sdk';
import { BeMusicElement } from '../base.ts';
import { baseStyles } from '../styles/base.ts';

export class BeMusicChartListElement extends BeMusicElement {
  static override properties: PropertyDeclarations = {
    entries: { attribute: false },
    selectedIndex: { type: Number },
    disabled: { type: Boolean },
  };
  static override styles: CSSResultGroup = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        flex: 1 1 auto;
        min-height: 0;
        max-height: var(--be-music-list-height, 55vh);
        overflow: auto;
        overscroll-behavior: contain;
      }
      button {
        display: grid;
        grid-template-columns: 48px 1fr;
        gap: 12px;
        width: 100%;
        text-align: left;
        margin-bottom: 5px;
        border-color: transparent;
      }
      button[aria-current='true'] {
        background: #293d59;
        border-color: var(--be-music-color-accent, #abcaff);
      }
      strong {
        display: block;
        overflow-wrap: anywhere;
      }
      .badge {
        color: var(--be-music-color-accent, #abcaff);
      }
    `,
  ];
  declare entries: readonly LibraryEntry[] | undefined;
  declare selectedIndex: number;
  declare disabled: boolean;
  private restoreListFocus = false;
  protected override willUpdate(changed: PropertyValues): void {
    this.restoreListFocus =
      (changed.has('selectedIndex') || changed.has('entries')) &&
      (this.renderRoot as ShadowRoot).activeElement?.tagName === 'BUTTON';
  }
  protected override updated(changed: PropertyValues): void {
    if (!changed.has('selectedIndex') && !changed.has('entries')) return;
    const current = this.renderRoot.querySelector<HTMLButtonElement>('[aria-current=true]');
    current?.scrollIntoView({ block: 'nearest' });
    if (this.restoreListFocus) current?.focus({ preventScroll: true });
  }
  private select(index: number, activate = false): void {
    this.emit('selection-change', { index });
    if (activate) this.emit('activate-request', { index });
  }
  protected override render(): TemplateResult {
    const entries = this.entries ?? [];
    return html`<ul class="rows" part="list" aria-label="Charts and folders">
        ${repeat(
          entries,
          (e) =>
            e.kind === 'chart'
              ? `chart:${e.chart.id}`
              : e.kind === 'course'
                ? `course:${e.course.id}`
                : `folder:${e.folder.label}`,
          (entry, index) => html`
            <li>
              <button
                part="row"
                aria-current=${String(index === this.selectedIndex)}
                .tabIndex=${index === this.selectedIndex ? 0 : -1}
                ?disabled=${this.disabled}
                @focus=${() => this.emit('selection-change', { index })}
                @click=${() => this.select(index, entry.kind === 'folder')}
                @dblclick=${() => {
                  if (entry.kind !== 'folder') this.select(index, true);
                }}
                @keydown=${(event: KeyboardEvent) => {
                  if (event.key === 'Enter' && !event.isComposing && !event.repeat) {
                    event.preventDefault();
                    event.stopPropagation();
                    this.select(index, true);
                  } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                    const count = entries.length;
                    if (count) this.select((index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
                  }
                }}
              >
                <span class="badge">${browseEntryBadge(entry)}</span
                ><span
                  ><strong>${browseEntryTitle(entry)}</strong
                  ><span class="muted"
                    >${entry.kind === 'chart' ? (entry.chart.artist ?? '') : (browseEntryCount(entry) ?? '')}</span
                  ></span
                >
              </button>
            </li>
          `,
        )}
      </ul>
      ${entries.length === 0 ? html`<p class="muted">No matching charts.</p>` : ''}`;
  }
}
