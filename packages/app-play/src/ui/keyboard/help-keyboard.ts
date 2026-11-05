// Help's Keyboard tab: a screen's keys drawn on a keyboard (`<be-music-keyboard-map>`) with the list of what each key
// does, from the player's own keys. The player picks the screen, the key map (LR2's or beatoraja's, starting on the one
// the current skin reads) and the keyboard's size (full or laptop, starting on the one the device most likely has); a Mac
// gets a Mac's keyboard, anything else a Windows PC's. Pointing at a line of the list lights its keys.
import { html, nothing, render, type TemplateResult } from 'lit';
import type { ControlScheme, ControlScreen, ControlSettings } from '@be-music/player-browser/host';
import { defineKeyboardMapElement } from './keyboard-element.ts';
import { buildKeyboardGuide, type KeyboardGuideLang, type KeyboardGuideRow } from './keyboard-guide.ts';
import { guessKeyboard, KEYBOARD_FORMS, type KeyboardForm, type KeyboardPlatform } from './keyboard-layout.ts';

/** Where the page reads the player's keys and the key map the current screen reads. */
export interface HelpKeyboardSource {
  readonly settings: ControlSettings;
  readonly scheme: ControlScheme;
}

const SCREENS: readonly ControlScreen[] = ['select', 'decide', 'play', 'result', 'global'];
const SCHEMES: readonly ControlScheme[] = ['lr2', 'beatoraja'];

const COPY = {
  en: {
    screen: 'Screen',
    keyMap: 'Key map',
    form: 'Keyboard size',
    forms: { full: 'Full', laptop: 'Laptop' },
    screens: { select: 'Select', decide: 'Decide', play: 'Play', result: 'Result', global: 'Every screen' },
    diagram: (screen: string) => `The keys of the ${screen} screen`,
    lanes: 'Lane keys',
    actions: 'Operations',
    legend: 'Numbers are the lane keys (white and black), ◎ the turntable, ST / SL START / SELECT, ● an operation.',
    note: 'Point at a line to light its keys. On a laptop, a key it lacks reads as the Fn combination that gives it (the number pad is the one built into the letter keys, where the laptop has one). Combinations and held keys are on the Usage tab; Options → Keys moves any key.',
    none: 'No operation on this key map.',
  },
  ja: {
    screen: '画面',
    keyMap: 'キー操作',
    form: 'キーボードの大きさ',
    forms: { full: 'フル', laptop: 'ノート' },
    screens: { select: '選曲', decide: '決定', play: 'プレイ', result: 'リザルト', global: '全画面' },
    diagram: (screen: string) => `${screen}画面のキー`,
    lanes: 'レーンのキー',
    actions: '操作',
    legend: '数字はレーンの鍵盤 (白鍵・黒鍵)、◎ は皿、ST / SL は START / SELECT、● は操作のキーです。',
    note: '行にカーソルを合わせるとそのキーが光ります。ノートにないキーは、それを入力する Fn との組み合わせで示します (テンキーは、文字キーに内蔵されたテンキーがあるノートでの組み合わせです)。同時押しや長押しは「使い方」タブに、キーの変更は Options → Keys にあります。',
    none: 'このキー操作にはありません。',
  },
} as const;

const SCHEME_NAMES: Readonly<Record<ControlScheme, string>> = { lr2: 'LR2', beatoraja: 'beatoraja' };

/** Draws Help's Keyboard tab into `root` and keeps it there. */
export class HelpKeyboard {
  private screen: ControlScreen = 'play';
  private scheme: ControlScheme | undefined;
  private readonly platform: KeyboardPlatform;
  private form: KeyboardForm;
  private active: readonly string[] = [];
  private lang: KeyboardGuideLang = 'en';
  private readonly root: HTMLElement;
  private readonly source: () => HelpKeyboardSource;

  public constructor(root: HTMLElement, source: () => HelpKeyboardSource) {
    this.root = root;
    this.source = source;
    ({ platform: this.platform, form: this.form } = guessKeyboard(devicePlatform()));
    defineKeyboardMapElement();
  }

  /** Draws the page in `lang`, on the key map the current screen reads the first time. */
  public show(lang: KeyboardGuideLang): void {
    this.lang = lang;
    this.scheme ??= this.source().scheme;
    this.update();
  }

  /** Starts again from the current screen's key map the next time Help opens. */
  public reset(): void {
    this.scheme = undefined;
    this.active = [];
  }

  private update(): void {
    render(this.template(), this.root);
  }

  private template(): TemplateResult {
    const copy = COPY[this.lang];
    const scheme = this.scheme ?? 'lr2';
    const guide = buildKeyboardGuide(this.screen, scheme, this.source().settings, this.lang, this.platform, this.form);
    const pick = <T>(value: T, current: T, label: string, set: () => void): TemplateResult =>
      html`<button
        type="button"
        class="btn"
        data-size="sm"
        data-variant=${value === current ? 'secondary' : 'outline'}
        aria-pressed=${value === current ? 'true' : 'false'}
        @click=${() => {
          set();
          this.active = [];
          this.update();
        }}
      >
        ${label}
      </button>`;
    // The pickers and the keyboard stay at the top of the panel while the lists scroll under them.
    return html`<div class="help-keyboard">
      <div class="help-keyboard-sticky">
        <div class="help-keyboard-controls">
          <div class="button-group" role="group" aria-label=${copy.screen}>
            ${SCREENS.map((screen) => pick(screen, this.screen, copy.screens[screen], () => (this.screen = screen)))}
          </div>
          <div class="button-group" role="group" aria-label=${copy.keyMap}>
            ${SCHEMES.map((value) => pick(value, scheme, SCHEME_NAMES[value], () => (this.scheme = value)))}
          </div>
          <div class="button-group" role="group" aria-label=${copy.form}>
            ${KEYBOARD_FORMS.map((value) => pick(value, this.form, copy.forms[value], () => (this.form = value)))}
          </div>
        </div>
        <be-music-keyboard-map
          .marks=${guide.marks}
          .active=${this.active}
          platform=${this.platform}
          form=${this.form}
          label=${copy.diagram(copy.screens[this.screen])}
        ></be-music-keyboard-map>
      </div>
      <p class="help-keyboard-legend">${copy.legend}</p>
      <div class="help-keyboard-lists">
        ${this.list(copy.actions, guide.actions, copy.none)} ${this.list(copy.lanes, guide.lanes)}
      </div>
      <p class="help-keyboard-note">${copy.note}</p>
    </div>`;
  }

  private list(title: string, rows: readonly KeyboardGuideRow[], empty?: string): TemplateResult {
    const light = (codes: readonly string[]): void => {
      this.active = codes;
      this.update();
    };
    return html`<section class="help-keyboard-list">
      <h4>${title}</h4>
      ${
        rows.length === 0 && empty !== undefined
          ? html`<p class="help-keyboard-empty">${empty}</p>`
          : html`<ul>
              ${rows.map(
                (row) =>
                  html`<li
                    tabindex="0"
                    ?data-active=${row.codes.length > 0 && row.codes.every((code) => this.active.includes(code))}
                    @pointerenter=${() => light(row.codes)}
                    @pointerleave=${() => light([])}
                    @focus=${() => light(row.codes)}
                    @blur=${() => light([])}
                  >
                    <span class="help-keyboard-name">${row.name}</span>
                    <span class="help-keyboard-keys"
                      >${row.keys.length === 0 ? '—' : nothing}${row.keys.map((key) => html`<kbd>${key}</kbd>`)}</span
                    >
                  </li>`,
              )}
            </ul>`
      }
    </section>`;
  }
}

/** The device's platform as the browser reports it (`macOS`, `Windows`, `MacIntel`, `Win32`), if it does. */
function devicePlatform(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const hinted = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  return hinted !== undefined && hinted !== '' ? hinted : navigator.platform;
}
