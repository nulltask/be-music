import { LitElement, css, html } from 'lit';

/** Position relative to the containing surface; inline lets a shared dock arrange several panels. */
export type PanelPosition =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'inline';

/** A reusable heading, keyboard-operable disclosure and scrollable content slot. */
export class CollapsiblePanelElement extends LitElement {
  static override properties = {
    heading: { type: String },
    open: { type: Boolean, reflect: true },
    position: { type: String, reflect: true },
  };
  declare heading: string;
  declare open: boolean;
  declare position: PanelPosition;

  constructor() {
    super();
    this.heading = '';
    this.open = true;
    this.position = 'bottom';
  }

  static override styles = css`
    :host {
      position: absolute;
      z-index: 40;
      display: block;
      width: min(420px, calc(100% - 16px));
      color: var(--popover-foreground, #eee);
      font: 13px/1.4 var(--font-sans, system-ui);
    }
    :host([hidden]) {
      display: none;
    }
    :host([position='inline']) {
      position: static;
      width: 100%;
      transform: none;
    }
    :host([position='top']) {
      top: 0;
      left: 50%;
      transform: translateX(-50%);
    }
    :host([position='bottom']) {
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
    }
    :host([position='left']) {
      left: 0;
      top: 50%;
      transform: translateY(-50%);
    }
    :host([position='right']) {
      right: 0;
      top: 50%;
      transform: translateY(-50%);
    }
    :host([position='center']) {
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
    }
    :host([position='top-left']) {
      top: 0;
      left: 0;
    }
    :host([position='top-right']) {
      top: 0;
      right: 0;
    }
    :host([position='bottom-left']) {
      bottom: 0;
      left: 0;
    }
    :host([position='bottom-right']) {
      bottom: 0;
      right: 0;
    }
    details {
      border: 1px solid var(--border, #333);
      border-radius: 8px;
      background: color-mix(in oklch, var(--popover, #171717) 92%, transparent);
      box-shadow: 0 -4px 16px #0005;
      backdrop-filter: blur(10px) saturate(140%);
      -webkit-backdrop-filter: blur(10px) saturate(140%);
    }
    summary {
      box-sizing: border-box;
      min-height: 44px;
      padding: 12px 16px;
      cursor: pointer;
      font-weight: 600;
    }
    summary:focus-visible {
      outline: 2px solid var(--ring, #aaa);
      outline-offset: -3px;
    }
    .content {
      padding: 0 16px 16px;
      max-height: min(320px, 40dvh);
      overflow: auto;
    }
    details:not([open]) > .content {
      display: none;
    }
    @media (prefers-reduced-transparency: reduce) {
      details {
        background: var(--popover, #171717);
        backdrop-filter: none;
      }
    }
  `;

  private isolateKeys(this: void, event: KeyboardEvent): void {
    if (event.key !== 'Escape') event.stopPropagation();
  }

  protected override render() {
    return html`<details
      @keydown=${this.isolateKeys}
      @keyup=${this.isolateKeys}
      .open=${this.open}
      @toggle=${(event: Event) => {
        const open = (event.currentTarget as HTMLDetailsElement).open;
        if (this.open === open) return;
        this.open = open;
        this.dispatchEvent(new CustomEvent('panel-toggle', { detail: { open }, bubbles: true, composed: true }));
      }}
    >
      <summary><span class="options-folder-title">${this.heading}</span></summary>
      <div class="content"><slot></slot></div>
    </details>`;
  }
}

customElements.define('be-music-collapsible-panel', CollapsiblePanelElement);

declare global {
  interface HTMLElementTagNameMap {
    'be-music-collapsible-panel': CollapsiblePanelElement;
  }
}
