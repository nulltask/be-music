import { html, css, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import { browseEntryCount, browseEntryTitle, type LibraryEntry } from '@be-music/player-skin-sdk';
import { BeMusicElement } from '../base.ts';
import { baseStyles } from '../styles/base.ts';

export class BeMusicChartDetailsElement extends BeMusicElement {
  static override properties: PropertyDeclarations = {
    entry: { attribute: false },
    launching: { type: Boolean },
    readText: { attribute: false },
  };
  static override styles: CSSResultGroup = [
    baseStyles,
    css`
      .card {
        display: grid;
        gap: 18px;
      }
      h2 {
        font-size: 18px;
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        max-height: 30vh;
        overflow: auto;
      }
    `,
  ];
  declare entry: LibraryEntry | undefined;
  declare launching: boolean;
  declare readText: string | undefined;
  protected override render(): TemplateResult {
    const entry = this.entry;
    const playable = !!entry && entry.kind !== 'folder';
    return html`<aside class="card" part="panel">
      <div>
        <p class="muted">${entry?.kind ?? 'Collection'}</p>
        <h2 part="title">${entry ? browseEntryTitle(entry) : 'No chart selected'}</h2>
        <p class="muted">${entry?.kind === 'chart' ? (entry.chart.artist ?? '') : ''}</p>
      </div>
      <p class="muted">
        ${entry?.kind === 'chart' ? `Level ${entry.chart.playLevel ?? '—'} · ${entry.chart.bpm ?? '—'} BPM` : entry ? (browseEntryCount(entry) ?? '') : ''}
      </p>
      <div class="actions">
        <button
          class="primary"
          ?disabled=${this.launching || !playable}
          @click=${() => this.emit('play-request', { autoPlay: false })}
        >
          Play</button
        ><button ?disabled=${this.launching || !playable} @click=${() => this.emit('play-request', { autoPlay: true })}>
          Auto play</button
        ><button
          ?disabled=${this.launching || entry?.kind !== 'chart'}
          @click=${() => this.emit('readme-request', undefined)}
        >
          Readme</button
        ><slot name="actions"></slot>
      </div>
      <pre ?hidden=${this.readText === undefined}>${this.readText ?? ''}</pre>
      <p class="muted">Arrow keys to browse · Enter to open · Escape to go back.</p>
      <slot></slot>
    </aside>`;
  }
}
