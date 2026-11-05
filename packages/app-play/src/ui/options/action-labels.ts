// The names the key config gives the lanes and the screens' operations and their keys (`keys.ts`, `action-keys.ts`),
// apart from the pages so `labels.ts` and the Help entries read them without the pages.
import {
  type ControlActionDefinition,
  type ControlActionKey,
  type ControlScheme,
  type ControlScreen,
} from '@be-music/player-browser/host';
import { LANE_KEY_CONFIG, type LaneKeyConfigLane, type LaneKeyGroup } from '@be-music/player-engine/lanes';

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
  'Ranking (hold)': 'ランキング (長押し)',
  'Edit level (hold)': 'レベルの編集 (長押し)',
  Help: 'ヘルプ',
  'Option panel 2': 'オプションパネル 2',
  'Option panel 3': 'オプションパネル 3',
  'Next difficulty': '次の難易度',
  'AUTO play': 'AUTO プレイ',
  Sort: 'ソート',
  'Key mode filter': '鍵盤数の絞り込み',
  'LN mode': 'LN モード',
  Search: '検索',
  'Copy MD5': 'MD5 をコピー',
  'Copy SHA-256': 'SHA-256 をコピー',
  'AUTO play the folder': 'フォルダを AUTO で再生',
  'Open its folder': '譜面のフォルダを開く',
  'Text file': 'テキストファイル',
  'Reload folders': 'フォルダの再読み込み',
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
  'AUTO speed ×0.25': 'AUTO の速度 ×0.25',
  'AUTO speed ×0.5': 'AUTO の速度 ×0.5',
  'AUTO speed ×2': 'AUTO の速度 ×2',
  'AUTO speed ×3': 'AUTO の速度 ×3',
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

/** A lane's name in the key config (`1P scratch`, `2P key 3`, `Key 9`), which `labels.ts` translates. */
export function laneKeyConfigLabel(group: LaneKeyGroup, lane: LaneKeyConfigLane): string {
  if (group === 'popn') return `Key ${lane.id}`;
  if (lane.scratch) return `${lane.side} scratch`;
  const keys = LANE_KEY_CONFIG.beat.filter((entry) => entry.side === lane.side && !entry.scratch);
  return `${lane.side} key ${keys.findIndex((entry) => entry.id === lane.id) + 1}`;
}
