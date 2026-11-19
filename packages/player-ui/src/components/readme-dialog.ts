import { html, css, nothing, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import { BeMusicElement } from '../base.ts';
import { splitLinkedText } from '../linkify.ts';
import { structureStyles } from '../styles/structure.ts';

/**
 * `<be-music-readme-dialog>`: a modal dialog showing a plain text file, such as the README shipped next to a chart. It is
 * open while {@link text} is set. Web and mail addresses in the text become links that open in a new tab; the rest
 * stays text (the text is never read as HTML). The dialog does not close itself: the close button, Escape and a click
 * on the backdrop send `readme-close`, and its owner clears {@link text}. With two or more {@link tabs} (the names of a
 * folder's text files), a tab row above the text sends `readme-tab` with the tab chosen, and its owner sets
 * {@link selectedTab} and {@link text}.
 */
export class BeMusicReadmeDialogElement extends BeMusicElement {
  static override properties: PropertyDeclarations = {
    text: { attribute: false },
    tabs: { attribute: false },
    selectedTab: { type: Number },
    heading: { type: String },
    subheading: { type: String },
    hint: { type: String },
  };
  static override styles: CSSResultGroup = [
    structureStyles,
    css`
      :host {
        display: contents;
      }
      dialog {
        /* A host may lay the element in a layer that lets the pointer through to a canvas below. */
        pointer-events: auto;
      }
      /* Wider and taller than Basecoat's default card: a README is read, often in long lines. */
      .dialog[open] > div {
        max-width: min(800px, calc(100% - 2rem));
        max-height: min(640px, calc(100% - 2rem));
        gap: 16px;
      }
      /* With tabs, the card keeps its height across them, so the tabs stay put as texts of other lengths show. */
      .dialog[open] > div.tabbed {
        height: min(640px, calc(100% - 2rem));
      }
      .tabbed > section {
        flex: 1;
      }
      header {
        min-width: 0;
      }
      h2 {
        overflow-wrap: anywhere;
      }
      header p {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* Many text files (a package's folder can hold a dozen) scroll sideways rather than wrap. */
      .tabs > [role='tablist'] {
        max-width: 100%;
        overflow-x: auto;
        scrollbar-width: none;
      }
      [role='tab'] {
        flex: none;
        max-width: 16rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      section {
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
        outline: none;
      }
      pre {
        margin: 0;
        /* Author notes are often aligned in columns or drawn in text: a fixed-width face keeps them, wrapping lines too
           long for the dialog. MS Gothic and Osaka-Mono, the faces they were written in, give CJK glyphs twice the
           half-width ones. */
        font-family: var(
          --be-music-readme-font,
          ui-monospace,
          SFMono-Regular,
          Menlo,
          Consolas,
          'MS Gothic',
          'Osaka-Mono',
          monospace
        );
        font-size: 13px;
        line-height: 1.6;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        tab-size: 4;
      }
      a {
        color: var(--primary, #8ab4ff);
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      footer {
        align-items: center;
      }
      .hint {
        margin-right: auto;
        font-size: 12px;
        color: var(--muted-foreground, #a9a39a);
      }
      @media (max-width: 40rem) {
        .hint {
          display: none;
        }
      }
    `,
  ];
  /** The text shown, or `undefined` while the dialog is closed. */
  declare text: string | undefined;
  /** The dialog's title. */
  declare heading: string;
  /** A line under the title, such as the chart the text belongs to; none when empty. */
  declare subheading: string;
  /** The keys that work in the dialog, shown at its foot on a wide screen; none when empty. */
  declare hint: string;
  /** The names of the texts to choose from, shown as tabs when there are two or more. */
  declare tabs: readonly string[];
  /** The tab of the text shown: an index into {@link tabs}. */
  declare selectedTab: number;

  public constructor() {
    super();
    this.heading = 'README';
    this.subheading = '';
    this.hint = '↑↓ to scroll · Enter or Esc to close';
    this.tabs = [];
    this.selectedTab = 0;
  }

  /** The hint with the tab keys added while there are tabs to switch. */
  private get shownHint(): string {
    if (!this.hint || this.tabs.length < 2) return this.hint;
    return `←→ to switch files · ${this.hint}`;
  }

  /** Whether the dialog is showing a text. */
  public get open(): boolean {
    return this.text !== undefined;
  }

  /** Scrolls the text by `delta` CSS pixels (positive: down), stopping at either end. */
  public scrollTextBy(delta: number): void {
    const body = this.renderRoot.querySelector('section');
    if (!body) return;
    body.scrollTop = Math.max(0, Math.min(body.scrollHeight - body.clientHeight, body.scrollTop + delta));
  }

  private requestClose(): void {
    this.emit('readme-close', undefined);
  }

  private requestTab(index: number): void {
    if (index !== this.selectedTab) this.emit('readme-tab', { index });
  }

  private renderTabs(): TemplateResult | typeof nothing {
    if (this.tabs.length < 2) return nothing;
    return html`<div class="tabs">
      <nav role="tablist" aria-orientation="horizontal" part="tabs">
        ${this.tabs.map(
          (name, index) =>
            html`<button
              type="button"
              role="tab"
              id=${`readme-tab-${index}`}
              aria-controls="readme-body"
              aria-selected=${index === this.selectedTab ? 'true' : 'false'}
              title=${name}
              @click=${() => this.requestTab(index)}
            >
              ${name}
            </button>`,
        )}
      </nav>
    </div>`;
  }

  private readonly onCancel = (event: Event): void => {
    // Escape: the owner closes the dialog by clearing the text.
    event.preventDefault();
    this.requestClose();
  };

  private readonly onClick = (event: MouseEvent): void => {
    // A click on the backdrop lands on the dialog element itself; one on the card lands on its contents.
    if (event.target === event.currentTarget) this.requestClose();
  };

  protected override render(): TemplateResult {
    const text = this.text;
    return html`<dialog
      class="dialog"
      part="dialog"
      aria-labelledby="readme-heading"
      @cancel=${this.onCancel}
      @click=${this.onClick}
    >
      <div class=${this.tabs.length >= 2 ? 'tabbed' : ''}>
        <header>
          <h2 id="readme-heading">${this.heading}</h2>
          ${this.subheading ? html`<p>${this.subheading}</p>` : nothing}
        </header>
        ${this.renderTabs()}
        <section
          id="readme-body"
          part="body"
          tabindex="0"
          autofocus
          role=${this.tabs.length >= 2 ? 'tabpanel' : nothing}
          aria-labelledby=${this.tabs.length >= 2 ? `readme-tab-${this.selectedTab}` : nothing}
        >
          <pre>
${
  text === undefined
    ? nothing
    : splitLinkedText(text).map((run) =>
        run.kind === 'link'
          ? html`<a href=${run.href} target="_blank" rel="noopener noreferrer">${run.text}</a>`
          : run.text,
      )
}</pre>
        </section>
        <footer>
          ${this.shownHint ? html`<p class="hint">${this.shownHint}</p>` : nothing}
          <button type="button" class="btn" data-variant="outline" @click=${() => this.requestClose()}>Close</button>
        </footer>
      </div>
    </dialog>`;
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    if (!changed.has('text')) return;
    const dialog = this.renderRoot.querySelector('dialog');
    if (!dialog) return;
    if (this.text === undefined) {
      if (dialog.open) dialog.close();
      return;
    }
    // Every text opens at its top, a tab switched to as well; the chosen tab scrolls into view.
    this.renderRoot
      .querySelector('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const body = this.renderRoot.querySelector('section');
    if (body) body.scrollTop = 0;
    if (!dialog.open && this.isConnected) dialog.showModal();
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.renderRoot.querySelector('dialog')?.close();
  }
}
