import { html, css, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import type { BeMusicDOMSelectFrame } from '@be-music/player-skin-sdk';
import type { BeMusicPlayOptionChange } from '../events.ts';
import { BeMusicElement } from '../base.ts';
import { baseStyles } from '../styles/base.ts';

const OPTIONS = [
  ['gauge1P', 'Gauge'],
  ['random1P', 'Lanes'],
  ['sort', 'Sort'],
  ['keysFilter', 'Key mode'],
  ['difficultyFilter', 'Difficulty'],
] as const;
export class BeMusicPlayOptionsElement extends BeMusicElement {
  static override properties: PropertyDeclarations = {
    options: { attribute: false },
    choices: { attribute: false },
    disabled: { type: Boolean },
  };
  static override styles: CSSResultGroup = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 16px 0;
      }
      label {
        display: grid;
        gap: 6px;
        color: #b8c7da;
        font-size: 12px;
      }
    `,
  ];
  declare options: BeMusicDOMSelectFrame['playOptions'] | undefined;
  declare choices: BeMusicDOMSelectFrame['playOptionChoices'] | undefined;
  declare disabled: boolean;
  protected override render(): TemplateResult {
    return html`${OPTIONS.map(
      ([key, label]) =>
        html`<label part="control"
          >${label}<select
            aria-label=${label}
            ?disabled=${this.disabled}
            @change=${(event: Event) => {
              const select = event.currentTarget as HTMLSelectElement;
              const value = this.choices?.[key]?.find((choice) => String(choice) === select.value);
              if (value !== undefined) this.emit('play-option-change', { key, value } as BeMusicPlayOptionChange);
            }}
          >
            ${(this.choices?.[key] ?? []).map((value) => html`<option .value=${String(value)} .selected=${value === this.options?.[key]}>${value}</option>`)}
          </select></label
        >`,
    )}`;
  }
}
