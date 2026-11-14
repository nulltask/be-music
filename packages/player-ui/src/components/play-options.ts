import { html, css, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import type { BeMusicDOMSelectFrame } from '@be-music/player-skin-sdk';
import type { BeMusicPlayOptionChange } from '../events.ts';
import { BeMusicElement } from '../base.ts';
import { structureStyles } from '../styles/structure.ts';

const OPTIONS = [
  ['gauge1P', 'Gauge'],
  ['random1P', 'Lanes'],
  ['sort', 'Sort'],
  ['keysFilter', 'Key mode'],
  ['difficultyFilter', 'Difficulty'],
] as const;
/**
 * `choices` with the selected value added when it is not one of them, so the select shows what is selected: a
 * source-qualified gauge (`lr2:HARD`) picked in the Options dialog is off the cycle the skin offers.
 */
function withCurrent<T>(choices: readonly T[], current: T | undefined): readonly T[] {
  return current === undefined || choices.includes(current) ? choices : [...choices, current];
}

export class BeMusicPlayOptionsElement extends BeMusicElement {
  static override properties: PropertyDeclarations = {
    options: { attribute: false },
    choices: { attribute: false },
    disabled: { type: Boolean },
  };
  static override styles: CSSResultGroup = [
    structureStyles,
    css`
      :host {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
        gap: var(--be-music-gap, 8px);
      }
      label {
        display: grid;
        gap: 4px;
        min-width: 0;
        font-size: 12px;
      }
      select {
        width: 100%;
        min-width: 0;
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
            class="select"
            aria-label=${label}
            ?disabled=${this.disabled}
            @change=${(event: Event) => {
              const select = event.currentTarget as HTMLSelectElement;
              const value = this.choices?.[key]?.find((choice) => String(choice) === select.value);
              if (value !== undefined) this.emit('play-option-change', { key, value } as BeMusicPlayOptionChange);
            }}
          >
            ${withCurrent(this.choices?.[key] ?? [], this.options?.[key]).map((value) => html`<option .value=${String(value)} .selected=${value === this.options?.[key]}>${value}</option>`)}
          </select></label
        >`,
    )}`;
  }
}
