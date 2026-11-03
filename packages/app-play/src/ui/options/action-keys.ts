// The key config's Screens page (the Keys tab): a row per operation of the select, decide, play and result screens with
// the keys it takes. Clicking a row's keys waits for the next key press and gives the operation that key in place of its
// defaults; Esc cancels, and a key another operation of the same screen takes is refused. An operation only one key map
// has says which; the others show the keys of the map the built-in skins read. Built with the dialog as `this`
// (`OptionsDialog`); the keys are `control-keys.ts`', read as each screen opens, so the rows are disabled during a play.
import {
  CONTROL_ACTIONS,
  controlActionKeys,
  type ControlActionDefinition,
  type ControlActionId,
  type ControlScheme,
  type ControlScreen,
} from '@be-music/player-browser/host';
import { html, render } from 'lit';
import { playerLang } from '../../player-copy.ts';
import { optionLabel } from './labels.ts';
import {
  ACTION_LABELS_JA,
  ACTION_SCREEN_TITLES,
  actionKeyConfigLabel,
  actionKeyLabel,
  keyCodeLabel,
  schemesOf,
} from './action-labels.ts';
import type { OptionContainer } from '../options-controls.ts';
import type { OptionsDialog } from './index.ts';

export { ACTION_LABELS_JA, ACTION_SCREEN_TITLES, actionKeyConfigLabel, actionKeyLabel, keyCodeLabel };

const PROMPTS = {
  en: { waiting: 'Press a key… (Esc cancels)', refused: 'Another operation here has that key — press another' },
  ja: {
    waiting: 'キーを押してください… (Esc で取り消し)',
    refused: 'この画面のほかの操作が使っています。別のキーを押してください',
  },
} as const;

/** Builds the Screens page into `page`; returns what shows its keys again (after the built-in skins' key map changes). */
export function buildActionKeyPage(this: OptionsDialog, page: OptionContainer): () => void {
  const views: (() => void)[] = [];
  let waiting: { readonly id: ControlActionId; refused?: boolean } | undefined;
  const prompts = () => PROMPTS[playerLang() === 'ja' ? 'ja' : 'en'];
  const definitionOf = (id: ControlActionId) =>
    CONTROL_ACTIONS.find((action) => action.id === id)! as ControlActionDefinition;
  /** The key map a row shows: the built-in skins' when the operation is on it, else the one it is on. */
  const schemeOf = (definition: ControlActionDefinition): ControlScheme => {
    const schemes = schemesOf(definition);
    return schemes.includes(this.guiState.builtInControlScheme) ? this.guiState.builtInControlScheme : schemes[0]!;
  };
  const keysOf = (id: ControlActionId) =>
    controlActionKeys(id, schemeOf(definitionOf(id)), this.guiState.actionKeys)
      .map(actionKeyLabel)
      .join(' / ');
  const paint = (): void => {
    for (const update of views) update();
  };
  const stop = (): void => {
    document.removeEventListener('keydown', onKey, true);
    waiting = undefined;
    paint();
  };
  /** Whether another operation of `id`'s screen takes `code` on a key map both are on. */
  const takenOnScreen = (id: ControlActionId, code: string): boolean => {
    const definition = definitionOf(id);
    return CONTROL_ACTIONS.some((other) => {
      if (other.id === id || other.screen !== definition.screen) return false;
      return schemesOf(definition).some((scheme) =>
        controlActionKeys(other.id, scheme, this.guiState.actionKeys).some((key) => 'code' in key && key.code === code),
      );
    });
  };
  const onKey = (event: KeyboardEvent): void => {
    if (waiting === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.code === 'Escape') {
      stop();
      return;
    }
    if (event.code === '' || takenOnScreen(waiting.id, event.code)) {
      waiting.refused = true;
      paint();
      return;
    }
    this.guiState.actionKeys = { ...this.guiState.actionKeys, [waiting.id]: [event.code] };
    this.scheduleSettingsSave();
    stop();
  };
  document.querySelector('#options-modal')?.addEventListener('close', () => {
    if (waiting !== undefined) stop();
  });

  let screen: ControlScreen | undefined;
  for (const action of CONTROL_ACTIONS) {
    const definition = action as ControlActionDefinition;
    if (definition.screen !== screen) {
      screen = definition.screen;
      const title = ACTION_SCREEN_TITLES[screen];
      const heading = document.createElement('h5');
      heading.className = 'options-key-heading';
      const show = (language: string): void => {
        render(html`${optionLabel(title, language)}`, heading);
      };
      show(playerLang());
      const row = page.addElement(heading, show);
      row.element.dataset.optionLabel = title;
    }
    const label = actionKeyConfigLabel(definition);
    const content = document.createElement('div');
    content.className = 'options-key-row';
    let language = playerLang();
    const update = (): void => {
      const active = waiting?.id === definition.id;
      const text = active ? (waiting?.refused === true ? prompts().refused : prompts().waiting) : keysOf(definition.id);
      render(
        html`<span class="options-label-wrap"
            ><span class="label options-label">${optionLabel(label, language)}</span><span data-option-help-host></span
          ></span>
          <button
            type="button"
            class="btn options-key"
            data-variant="outline"
            data-size="sm"
            aria-pressed=${String(active)}
            @click=${() => {
              if (waiting?.id === definition.id) {
                stop();
                return;
              }
              if (waiting === undefined) document.addEventListener('keydown', onKey, true);
              waiting = { id: definition.id };
              paint();
            }}
          >
            ${text}
          </button>`,
        content,
      );
    };
    const row = page.addElement(content, (nextLanguage) => {
      language = nextLanguage === 'ja' ? 'ja' : 'en';
      update();
    });
    row.element.dataset.optionLabel = label;
    this.trackPlayOption(row);
    views.push(update);
  }
  this.trackPlayOption(
    page.addButton({ title: 'Reset screen keys to defaults' }).on('click', () => {
      if (waiting !== undefined) stop();
      this.guiState.actionKeys = {};
      this.scheduleSettingsSave();
      paint();
    }),
  );
  paint();
  return paint;
}
