// What Help's keyboard page shows for a screen: the keys to mark on `<be-music-keyboard-map>` and the list of what each
// key does, made from the player's own keys (lane keys, START / SELECT, each operation's keys) and the key map
// (LR2's or beatoraja's), as the screens read them.
import {
  CONTROL_ACTIONS,
  controlActionKeys,
  keyboardEventToTokens,
  resolveControlButtons,
  type ControlActionDefinition,
  type ControlActionKey,
  type ControlButton,
  type ControlScheme,
  type ControlScreen,
  type ControlSettings,
} from '@be-music/player-browser/host';
import { ACTION_LABELS_JA } from '../options/action-labels.ts';
import type { KeyboardMark, KeyboardMarkKind } from './keyboard-element.ts';
import {
  KEYBOARD_CODES,
  keyboardKey,
  keyboardReach,
  type KeyboardForm,
  type KeyboardPlatform,
} from './keyboard-layout.ts';

export type KeyboardGuideLang = 'en' | 'ja';

/** One line of the list: what is done, the keys that do it as they read, and their codes to light. */
export interface KeyboardGuideRow {
  readonly id: string;
  readonly name: string;
  readonly keys: readonly string[];
  readonly codes: readonly string[];
}

/** A screen's keyboard page: the marked keys, the lane rows and the screen's operations. */
export interface KeyboardGuide {
  readonly marks: readonly KeyboardMark[];
  /** The player's lane keys and START / SELECT, which every screen reads. */
  readonly lanes: readonly KeyboardGuideRow[];
  /** The screen's operations on the key map, with the player's own keys. */
  readonly actions: readonly KeyboardGuideRow[];
}

const COPY = {
  en: {
    keys: (side: string) => `${side} keys 1–7`,
    turntable: (side: string) => `${side} turntable`,
    startSelect: (side: string) => `${side} START / SELECT`,
    key: (side: string, n: string) => `${side} key ${n}`,
    scratch: (side: string, second: boolean) => `${side} turntable ${second ? '↺' : '↻'}`,
    noKey: (name: string) => `${name} (no key)`,
  },
  ja: {
    keys: (side: string) => `${side} 鍵盤 1〜7`,
    turntable: (side: string) => `${side} 皿`,
    startSelect: (side: string) => `${side} START / SELECT`,
    key: (side: string, n: string) => `${side} 鍵盤 ${n}`,
    scratch: (side: string, second: boolean) => `${side} 皿 ${second ? '↺' : '↻'}`,
    noKey: (name: string) => `${name} (キーなし)`,
  },
} as const;

/** How a key reads in the list on `platform`'s keyboard (`Left Shift`, `F4`, `Num 0`, a Mac's `Left Option`). */
export function keyboardKeyName(code: string, platform: KeyboardPlatform = 'windows'): string {
  return keyboardKey(code, platform)?.name ?? code;
}

/** How a control button reads (`1P key 3`, `1P turntable ↻`, its second key `↺`, `1P START`). */
export function controlButtonName(button: ControlButton, lang: KeyboardGuideLang = 'en'): string {
  const [side = '1P', ...rest] = button.split('-');
  const name = rest.join('-');
  if (name === 'start' || name === 'select') return `${side} ${name.toUpperCase()}`;
  if (name.startsWith('key')) return COPY[lang].key(side, name.slice(3));
  return COPY[lang].scratch(side, name === 'scratch-ccw');
}

/** Each layout key's buttons under `settings`, in the key's token order. */
function buttonsByCode(settings: ControlSettings): Map<string, ControlButton[]> {
  const map = resolveControlButtons(settings);
  const result = new Map<string, ControlButton[]>();
  for (const code of KEYBOARD_CODES) {
    const buttons: ControlButton[] = [];
    for (const token of keyboardEventToTokens({ code })) {
      for (const button of map.get(token) ?? []) if (!buttons.includes(button)) buttons.push(button);
    }
    if (buttons.length > 0) result.set(code, buttons);
  }
  return result;
}

/** The mark of a key a button takes: white or black by the key's number, the turntable, or START / SELECT. */
function buttonMark(code: string, button: ControlButton, lang: KeyboardGuideLang): KeyboardMark {
  const name = button.split('-').slice(1).join('-');
  const title = controlButtonName(button, lang);
  if (name === 'start') return { code, kind: 'control', tag: 'ST', title };
  if (name === 'select') return { code, kind: 'control', tag: 'SL', title };
  if (name.startsWith('scratch')) return { code, kind: 'scratch', title };
  const n = Number(name.slice(3));
  const kind: KeyboardMarkKind = n % 2 === 1 ? 'white' : 'black';
  return { code, kind, tag: String(n), title };
}

/** An operation's name in `lang`. */
function actionName(definition: ControlActionDefinition, lang: KeyboardGuideLang): string {
  return lang === 'ja' ? (ACTION_LABELS_JA[definition.label] ?? definition.label) : definition.label;
}

/** The keyboard the page draws: whose caps, and full-size or a laptop's. */
interface GuideKeyboard {
  readonly platform: KeyboardPlatform;
  readonly form: KeyboardForm;
}

/**
 * How a key reads on `keyboard`: its name, the combination a laptop presses for it (`Fn+←` for Home, `Fn+M` for Num 0),
 * or its name marked as a key the keyboard does not have.
 */
function guideKeyName(code: string, keyboard: GuideKeyboard, lang: KeyboardGuideLang): string {
  const reach = keyboardReach(code, keyboard.platform, keyboard.form);
  if (reach.kind === 'combo') return reach.keys.map((key) => key.label).join('+');
  const name = keyboardKeyName(code, keyboard.platform);
  return reach.kind === 'none' && keyboardKey(code) !== undefined ? COPY[lang].noKey(name) : name;
}

/** The keys to light for `code` on `keyboard`: its own, or the combination a laptop presses for it. */
function guideKeyCodes(code: string, keyboard: GuideKeyboard): string[] {
  const reach = keyboardReach(code, keyboard.platform, keyboard.form);
  return reach.kind === 'combo' ? reach.keys.map((key) => key.code) : [code];
}

/** How an operation's key reads, with the modifiers it asks for (`Ctrl+Shift+F3`, a Mac's `⌃⇧F3`). */
function actionKeyName(
  definition: ControlActionDefinition,
  key: ControlActionKey,
  lang: KeyboardGuideLang,
  keyboard: GuideKeyboard,
): string {
  if ('button' in key) return controlButtonName(key.button, lang);
  const modifiers = definition.modifiers;
  const [ctrl, shift] = keyboard.platform === 'mac' ? ['⌃', '⇧'] : ['Ctrl+', 'Shift+'];
  const prefix = modifiers === undefined ? '' : `${modifiers.ctrl ? ctrl : ''}${modifiers.shift ? shift : ''}`;
  return `${prefix}${guideKeyName(key.code, keyboard, lang)}`;
}

/**
 * The keyboard page of `screen` on the `scheme` key map with the player's keys (`settings`): the lane keys and START /
 * SELECT marked by what they are, the keys of the screen's operations marked ●, the lanes listed first and the
 * operations after, each with its keys. An operation's lane-key default lights the lane keys that button is on. Keys
 * are named as `platform`'s keyboard labels them; on a laptop (`form`), a key it has no key for reads as the Fn
 * combination that gives it and lights that combination, and a key no combination gives is marked as missing.
 */
export function buildKeyboardGuide(
  screen: ControlScreen,
  scheme: ControlScheme,
  settings: ControlSettings,
  lang: KeyboardGuideLang = 'en',
  platform: KeyboardPlatform = 'windows',
  form: KeyboardForm = 'full',
): KeyboardGuide {
  const keyboard: GuideKeyboard = { platform, form };
  const name = (code: string): string => guideKeyName(code, keyboard, lang);
  const light = (codes: readonly string[]): string[] => [
    ...new Set(codes.flatMap((code) => guideKeyCodes(code, keyboard))),
  ];
  const copy = COPY[lang];
  const buttons = buttonsByCode(settings);
  const codesOf = (button: ControlButton): string[] =>
    [...buttons].flatMap(([code, list]) => (list.includes(button) ? [code] : []));

  const marks = new Map<string, KeyboardMark>();
  for (const [code, list] of buttons) marks.set(code, buttonMark(code, list[0]!, lang));

  const lanes: KeyboardGuideRow[] = [];
  for (const side of ['1P', '2P'] as const) {
    const keyCodes = ([1, 2, 3, 4, 5, 6, 7] as const).map((n) => codesOf(`${side}-key${n}`));
    lanes.push({
      id: `${side}-keys`,
      name: copy.keys(side),
      keys: keyCodes.map((codes) => codes.map(name).join(' / ')),
      codes: light(keyCodes.flat()),
    });
    const scratch = [...codesOf(`${side}-scratch-cw`), ...codesOf(`${side}-scratch-ccw`)];
    lanes.push({
      id: `${side}-scratch`,
      name: copy.turntable(side),
      keys: scratch.map(name),
      codes: light(scratch),
    });
    const control = [...codesOf(`${side}-start`), ...codesOf(`${side}-select`)];
    lanes.push({
      id: `${side}-control`,
      name: copy.startSelect(side),
      keys: control.map(name),
      codes: light(control),
    });
  }

  const actions: KeyboardGuideRow[] = [];
  for (const definition of CONTROL_ACTIONS) {
    if (definition.screen !== screen) continue;
    const keys = controlActionKeys(definition.id, scheme, settings.actionKeys);
    if (keys.length === 0) continue;
    const label = actionName(definition, lang);
    const codes: string[] = [];
    for (const key of keys) {
      if ('button' in key) {
        codes.push(...codesOf(key.button));
        continue;
      }
      codes.push(key.code);
      const mark = marks.get(key.code);
      if (mark === undefined) marks.set(key.code, { code: key.code, kind: 'action', title: label });
      else if (mark.kind === 'action') marks.set(key.code, { ...mark, title: `${mark.title} · ${label}` });
    }
    actions.push({
      id: definition.id,
      name: label,
      keys: keys.map((key) => actionKeyName(definition, key, lang, keyboard)),
      codes: light(codes),
    });
  }
  return { marks: [...marks.values()], lanes, actions };
}
