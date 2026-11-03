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
  type ControlActionKey,
  type ControlScheme,
  type ControlScreen,
} from '@be-music/player-browser/host';
import { playerLang } from '../../player-copy.ts';
import type { OptionContainer } from '../options-controls.ts';
import type { OptionsDialog } from './index.ts';

/** Each screen's heading on the page. */
export const ACTION_SCREEN_TITLES: Readonly<Record<ControlScreen, string>> = {
  select: 'Select screen',
  decide: 'Decide screen',
  play: 'Play',
  result: 'Result screen',
};

/** The Japanese of each operation's name and of the screens' headings, for `labels.ts`. */
export const ACTION_LABELS_JA: Readonly<Record<string, string>> = {
  'Next bar': '次のバー',
  'Previous bar': '前のバー',
  'Ten bars down': '10 バー下へ',
  'Ten bars up': '10 バー上へ',
  'First bar': '最初のバー',
  'Last bar': '最後のバー',
  'Random bar': 'ランダムなバー',
  'Open / play': '開く / プレイ',
  Back: '戻る',
  'Close folder': 'フォルダを閉じる',
  'PLAY OPTION panel': 'PLAY OPTION パネル',
  'Next replay slot': '次のリプレイスロット',
  Replay: 'リプレイ',
  Continue: '進む',
  'Back to select': '選曲画面へ戻る',
  Quit: '中断',
  'Quit (hold)': '中断 (長押し)',
  Restart: 'リスタート',
  Pause: 'ポーズ',
  'Hi-speed up': 'ハイスピードを上げる',
  'Hi-speed down': 'ハイスピードを下げる',
  'FLOATING HI-SPEED': 'FLOATING HI-SPEED',
  'Restore green number (twice)': '緑数字を戻す (2 回押し)',
  'Seek back (AUTO)': '5 秒戻る (AUTO)',
  'Seek forward (AUTO)': '5 秒進む (AUTO)',
  'SUDDEN+ up': 'SUDDEN+ を上げる',
  'SUDDEN+ down': 'SUDDEN+ を下げる',
  'LIFT up': 'LIFT を上げる',
  'LIFT down': 'LIFT を下げる',
  'HIDDEN+ on / off': 'HIDDEN+ のオン / オフ',
  'HIDDEN+ up': 'HIDDEN+ を上げる',
  'HIDDEN+ down': 'HIDDEN+ を下げる',
  'M-SUDDEN down': 'M-SUDDEN を下げる',
  'M-SUDDEN up': 'M-SUDDEN を上げる',
  Next: '次へ',
  Leave: '抜ける',
  Retry: 'リトライ',
  ...Object.fromEntries([1, 2, 3, 4].map((slot) => [`Save replay ${slot}`, `リプレイを保存 ${slot}`])),
  'Select screen': '選曲画面',
  'Decide screen': '決定画面',
  Play: 'プレイ',
  'Result screen': 'リザルト画面',
};

const SCHEME_NAMES: Readonly<Record<ControlScheme, string>> = { lr2: 'LR2', beatoraja: 'beatoraja' };

/** The key maps an operation is on. */
function schemesOf(definition: ControlActionDefinition): ControlScheme[] {
  return (['lr2', 'beatoraja'] as const).filter((scheme) => definition.defaults[scheme] !== undefined);
}

/** An operation's name in the key config, with the key map it is on when only one has it (`Ten bars down (beatoraja)`). */
export function actionKeyConfigLabel(definition: ControlActionDefinition, lang = 'en'): string {
  const name = lang === 'ja' ? (ACTION_LABELS_JA[definition.label] ?? definition.label) : definition.label;
  const schemes = schemesOf(definition);
  return schemes.length === 1 ? `${name} (${SCHEME_NAMES[schemes[0]!]})` : name;
}

/** How a key code reads (`R`, `4`, `↓`, `Num 0`, `Esc`). */
export function keyCodeLabel(code: string): string {
  if (/^Key[A-Z]$/u.test(code)) return code.slice(3);
  if (/^Digit\d$/u.test(code)) return code.slice(5);
  if (/^Numpad\d$/u.test(code)) return `Num ${code.slice(6)}`;
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  if (arrows[code] !== undefined) return arrows[code]!;
  if (code === 'Escape') return 'Esc';
  return code;
}

/** How an operation's key reads: a code, or a button (`1P START`, `1P key 6`). */
export function actionKeyLabel(key: ControlActionKey): string {
  if ('code' in key) return keyCodeLabel(key.code);
  const [side, ...rest] = key.button.split('-');
  const name = rest.join('-');
  if (name === 'start' || name === 'select') return `${side} ${name.toUpperCase()}`;
  if (name.startsWith('key')) return `${side} key ${name.slice(3)}`;
  return `${side} scratch`;
}

const PROMPTS = {
  en: { waiting: 'Press a key… (Esc cancels)', refused: 'Another operation here has that key — press another' },
  ja: {
    waiting: 'キーを押してください… (Esc で取り消し)',
    refused: 'この画面のほかの操作が使っています。別のキーを押してください',
  },
} as const;

/** Builds the Screens page into `page`; returns what shows its keys again (after the built-in skins' key map changes). */
export function buildActionKeyPage(this: OptionsDialog, page: OptionContainer): () => void {
  const rows: { readonly id: ControlActionId; readonly button: HTMLButtonElement }[] = [];
  let waiting: ControlActionId | undefined;
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
    for (const { id, button } of rows) {
      button.textContent = waiting === id ? prompts().waiting : keysOf(id);
      button.setAttribute('aria-pressed', waiting === id ? 'true' : 'false');
    }
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
    const button = rows.find((row) => row.id === waiting)?.button;
    if (event.code === '' || takenOnScreen(waiting, event.code)) {
      if (button) button.textContent = prompts().refused;
      return;
    }
    this.guiState.actionKeys = { ...this.guiState.actionKeys, [waiting]: [event.code] };
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
      const heading = document.createElement('h5');
      heading.className = 'options-label options-key-heading';
      heading.textContent = ACTION_SCREEN_TITLES[screen];
      const row = page.addElement(heading);
      row.element.dataset.optionLabel = ACTION_SCREEN_TITLES[screen];
    }
    const label = actionKeyConfigLabel(definition);
    const content = document.createElement('div');
    content.className = 'options-key-row';
    const name = document.createElement('span');
    name.className = 'label options-label';
    name.textContent = label;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn options-key';
    button.dataset.variant = 'outline';
    button.dataset.size = 'sm';
    button.addEventListener('click', () => {
      if (waiting === definition.id) {
        stop();
        return;
      }
      if (waiting === undefined) document.addEventListener('keydown', onKey, true);
      waiting = definition.id;
      paint();
    });
    content.append(name, button);
    const row = page.addElement(content);
    row.element.dataset.optionLabel = label;
    this.trackPlayOption(row);
    rows.push({ id: definition.id, button });
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
