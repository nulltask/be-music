// `<be-music-keyboard-map>`: a US keyboard (`keyboard-layout.ts`) with the keys in use marked, for Help's keyboard page.
// A mark says what a key is: a lane's white or black key (its number on the cap), a turntable (◎), START / SELECT (ST /
// SL), or a key an operation takes (●), so it reads without its colour. `active` lights the keys of the operation the
// player points at in the list beside it.
import { css, html, LitElement, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { keyboardLayout, type KeyboardKey } from './keyboard-layout.ts';

/** What a marked key is. */
export type KeyboardMarkKind = 'white' | 'black' | 'scratch' | 'control' | 'action';

/** A key in use: its code, what it is, the short tag on its cap and its tooltip. */
export interface KeyboardMark {
  readonly code: string;
  readonly kind: KeyboardMarkKind;
  /** The tag drawn on the cap (a lane number, ◎, ST); an operation's key gets ●. */
  readonly tag?: string;
  /** What the key does, for its tooltip. */
  readonly title?: string;
}

/** The tag a mark of `kind` shows without one of its own. */
const DEFAULT_TAGS: Readonly<Record<KeyboardMarkKind, string>> = {
  white: '',
  black: '',
  scratch: '◎',
  control: '',
  action: '●',
};

export class BeMusicKeyboardMapElement extends LitElement {
  static override properties: PropertyDeclarations = {
    marks: { attribute: false },
    active: { attribute: false },
    label: {},
  };

  /** The keys in use. A key with no mark is drawn dimmed. */
  declare marks: readonly KeyboardMark[];
  /** The codes to light, as the keys of the operation pointed at. */
  declare active: readonly string[];
  /** The diagram's accessible name; the list next to it says what each key does. */
  declare label: string;

  constructor() {
    super();
    this.marks = [];
    this.active = [];
    this.label = '';
  }

  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
      --key-accent: var(--primary, #38bdf8);
    }
    .board {
      /* Container units here measure the host, the container; on the host itself they would measure its parent. */
      --key-unit: calc(100cqi / var(--keyboard-width));
      --key-gap: max(1px, calc(var(--key-unit) * 0.06));
      position: relative;
      width: 100%;
      height: calc(var(--key-unit) * var(--keyboard-height));
    }
    .key {
      position: absolute;
      box-sizing: border-box;
      left: calc(var(--key-unit) * var(--x) + var(--key-gap) / 2);
      top: calc(var(--key-unit) * var(--y) + var(--key-gap) / 2);
      width: calc(var(--key-unit) * var(--w) - var(--key-gap));
      height: calc(var(--key-unit) * var(--h) - var(--key-gap));
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: calc(var(--key-unit) * 0.06) calc(var(--key-unit) * 0.09);
      border: 1px solid rgb(255 255 255 / 0.1);
      border-radius: calc(var(--key-unit) * 0.12);
      background: rgb(20 24 34 / 0.55);
      color: rgb(151 163 179 / 0.55);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: calc(var(--key-unit) * 0.24);
      line-height: 1;
      overflow: hidden;
      transition:
        outline-color 120ms ease,
        transform 120ms ease;
      outline: 2px solid transparent;
      outline-offset: 1px;
    }
    .cap {
      white-space: nowrap;
    }
    .tag {
      align-self: flex-end;
      font-size: calc(var(--key-unit) * 0.34);
      font-weight: 700;
    }
    .key[data-kind] {
      color: #f8fafc;
      border-color: rgb(255 255 255 / 0.28);
      background: rgb(30 36 50 / 0.95);
      box-shadow: 0 1px 0 rgb(0 0 0 / 0.4);
    }
    .key[data-kind='white'] {
      background: #e8edf5;
      border-color: #e8edf5;
      color: #0b0f17;
    }
    .key[data-kind='black'] {
      background: #05070b;
      border-color: rgb(255 255 255 / 0.7);
    }
    .key[data-kind='scratch'] {
      background: color-mix(in oklch, var(--key-accent) 40%, #05070b);
      border-color: var(--key-accent);
    }
    .key[data-kind='control'] {
      border-style: dashed;
      border-color: var(--key-accent);
      background: color-mix(in oklch, var(--key-accent) 18%, #05070b);
    }
    .key[data-kind='action'] {
      border-color: color-mix(in oklch, var(--key-accent) 65%, transparent);
      background: color-mix(in oklch, var(--key-accent) 24%, #05070b);
    }
    .key[data-kind='action'] .tag {
      color: var(--key-accent);
      font-size: calc(var(--key-unit) * 0.22);
    }
    .key[data-active] {
      outline-color: var(--key-accent);
      box-shadow: 0 0 calc(var(--key-unit) * 0.35) var(--key-accent);
      transform: translateY(-1px);
      z-index: 1;
    }
    .key[data-active]:not([data-kind='white']) {
      background: var(--key-accent);
      border-color: var(--key-accent);
      color: #0b0f17;
    }
    .key[data-active] .tag {
      color: inherit;
    }
  `;

  protected override render(): TemplateResult {
    const marks = new Map(this.marks.map((mark) => [mark.code, mark]));
    const active = new Set(this.active);
    const numpad = this.marks.some((mark) => mark.code.startsWith('Numpad') || mark.code === 'NumLock');
    const layout = keyboardLayout({ numpad });
    return html`<div
      class="board"
      role="img"
      aria-label=${this.label}
      style="--keyboard-width: ${layout.width}; --keyboard-height: ${layout.height}"
    >
      ${layout.keys.map((key) => this.renderKey(key, marks.get(key.code), active.has(key.code)))}
    </div>`;
  }

  private renderKey(key: KeyboardKey, mark: KeyboardMark | undefined, active: boolean): TemplateResult {
    const tag = mark === undefined ? '' : (mark.tag ?? DEFAULT_TAGS[mark.kind]);
    return html`<div
      class="key"
      part="key"
      data-code=${key.code}
      data-kind=${mark?.kind ?? nothing}
      ?data-active=${active}
      title=${mark?.title ?? nothing}
      aria-hidden="true"
      style="--x: ${key.x}; --y: ${key.y}; --w: ${key.width}; --h: ${key.height}"
    >
      <span class="cap">${key.label}</span>
      ${tag === '' ? nothing : html`<span class="tag">${tag}</span>`}
    </div>`;
  }
}

/** Registers `<be-music-keyboard-map>` once. */
export function defineKeyboardMapElement(
  registry: CustomElementRegistry | undefined = globalThis.customElements,
): void {
  if (registry !== undefined && registry.get('be-music-keyboard-map') === undefined)
    registry.define('be-music-keyboard-map', BeMusicKeyboardMapElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'be-music-keyboard-map': BeMusicKeyboardMapElement;
  }
}
