// The names the key config's Screens page gives the screens' operations and their keys (`action-keys.ts`), apart from
// the page so `labels.ts` and the Help entry read them without the page.
import {
  type ControlActionDefinition,
  type ControlActionKey,
  type ControlScheme,
  type ControlScreen,
} from '@be-music/player-browser/host';

/** Each screen's heading on the page. */
export const ACTION_SCREEN_TITLES: Readonly<Record<ControlScreen, string>> = {
  global: 'Every screen',
  select: 'Select screen',
  decide: 'Decide screen',
  play: 'Play',
  result: 'Result screen',
};

/** The Japanese of each operation's name and of the screens' headings, for `labels.ts`. */
export const ACTION_LABELS_JA: Readonly<Record<string, string>> = {
  'Full screen': 'フルスクリーン',
  Screenshot: 'スクリーンショット',
  'Frame rate': 'フレームレート',
  'Open folder': 'フォルダを開く',
  'Option panel 2': 'オプションパネル 2',
  'Option panel 3': 'オプションパネル 3',
  'Next difficulty': '次の難易度',
  'AUTO play': 'AUTO プレイ',
  Sort: 'ソート',
  'Key mode filter': '鍵盤数の絞り込み',
  'LN mode': 'LN モード',
  Search: '検索',
  'Favorite song': 'お気に入りの曲',
  'Favorite chart': 'お気に入りの譜面',
  'Every screen': 'すべての画面',
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
  'Lane cover up': 'レーンカバーを上げる',
  'Lane cover down': 'レーンカバーを下げる',
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
export function schemesOf(definition: ControlActionDefinition): ControlScheme[] {
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

/** How an operation's key reads: a code, or a button (`1P START`, `1P key 6`, `1P scratch ↺` for its second key). */
export function actionKeyLabel(key: ControlActionKey): string {
  if ('code' in key) return keyCodeLabel(key.code);
  const [side, ...rest] = key.button.split('-');
  const name = rest.join('-');
  if (name === 'start' || name === 'select') return `${side} ${name.toUpperCase()}`;
  if (name.startsWith('key')) return `${side} key ${name.slice(3)}`;
  return `${side} scratch ${name === 'scratch-ccw' ? '↺' : '↻'}`;
}
