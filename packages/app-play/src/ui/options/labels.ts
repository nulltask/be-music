// The Options dialog's labels in Japanese: its controls, buttons, folder titles and tabs, by their English text. The
// English text stays each control's name (its help, the e2e helpers and the stored settings go by it); the dialog shows
// this table's text when the player's language is Japanese (`relabelOptions`). The terms the sources print in capitals
// (HS-FIX, GAUGE TYPE, M-RAN, …) and the format names stay as they are, as LR2 and beatoraja show them.

import { CONTROL_ACTIONS } from '@be-music/player-browser/host';
import { ACTION_LABELS_JA, actionKeyConfigLabel } from './action-labels.ts';

/** Japanese for each English label, title and tab of the Options dialog. */
export const OPTION_LABELS_JA: Readonly<Record<string, string>> = {
  // Tabs
  Play: 'プレイ',
  View: '表示',
  Keys: 'キー',
  Skin: 'スキン',
  Audio: 'サウンド',
  Library: 'ライブラリ',
  Leaderboard: 'Leaderboard',
  Advanced: '詳細',
  'Judge & gauge': '判定とゲージ',
  Arrangement: '配置',
  Modifiers: '譜面の変更',
  Assist: 'アシスト',
  Practice: '練習',
  'Replay / ghost': 'リプレイとゴースト',
  'Cover & LIFT': 'カバーと LIFT',
  Effects: '演出',
  'Skin & display': 'スキンと表示',
  'BGA camera': 'BGA カメラ',
  Select: '選曲',
  'Quick options': 'よく使うオプション',
  'Built-in': '内蔵',
  // Folder titles
  'Key config': 'キーコンフィグ',
  'Play options': 'プレイオプション',
  Tempo: 'テンポ',
  Course: 'コース',
  'Skin settings': 'スキンの設定',
  'Beatoraja skins': 'beatoraja スキン',
  'Add skin': 'スキンの追加',
  Compressor: 'コンプレッサー',
  Stages: '段ごとのオン / オフ',
  'Key compressor': 'キー音のコンプレッサー',
  'BGM compressor': 'BGM のコンプレッサー',
  'Master compressor': '全体のコンプレッサー',
  'Legacy compressor': '旧方式のコンプレッサー',
  'Library & records': 'ライブラリと記録',
  'Replay slots': 'リプレイスロット',
  'BGA video transcode': 'BGA 動画の変換',
  Capture: 'キャプチャ',
  // Judge & gauge
  'Auto play': 'オートプレイ',
  Gauge: 'ゲージ',
  'Judge algorithm': '判定アルゴリズム',
  'bmson TOTAL 0': 'bmson の TOTAL 0',
  'Gauge auto-shift': 'ゲージ自動切り替え',
  'Lowest auto-shift gauge': '自動切り替えの最低ゲージ',
  'LN MODE (beatoraja)': 'LN MODE (beatoraja)',
  'CUSTOM JUDGE (beatoraja)': 'CUSTOM JUDGE (beatoraja)',
  'Key PGREAT %': 'キー PGREAT %',
  'Key GREAT %': 'キー GREAT %',
  'Key GOOD %': 'キー GOOD %',
  'Scratch PGREAT %': 'スクラッチ PGREAT %',
  'Scratch GREAT %': 'スクラッチ GREAT %',
  'Scratch GOOD %': 'スクラッチ GOOD %',
  'LN margin %': 'LN の猶予 %',
  'Auto judge timing': '判定タイミングの自動調整',
  'Judge timing (ms)': '判定タイミング (ms)',
  // Lanes
  'Random 1P': 'ランダム 1P',
  'Random 2P': 'ランダム 2P',
  'H-RANDOM threshold BPM (beatoraja)': 'H-RANDOM のしきい値 BPM (beatoraja)',
  'Fixed key 1P (LR2; 0=default)': '固定キー 1P (LR2、0=既定)',
  'Fixed key 2P (LR2; 0=default)': '固定キー 2P (LR2、0=既定)',
  'Seed 1P (-1=random)': 'シード 1P (-1=ランダム)',
  'Seed 2P (-1=random)': 'シード 2P (-1=ランダム)',
  '7-to-9 (beatoraja)': '7to9 (beatoraja)',
  '7-to-9 scratch': '7to9 のスクラッチ',
  'Reuse previous arrangement': '前回の配置を使う',
  'New arrangement': '新しい配置',
  'DP flip': 'DP フリップ',
  'Auto scratch 1P': 'オートスクラッチ 1P',
  'Auto scratch 2P': 'オートスクラッチ 2P',
  Battle: 'バトル',
  'Gauge 2P': 'ゲージ 2P',
  'M-RAN 1P': 'M-RAN 1P',
  'M-RAN 2P': 'M-RAN 2P',
  'D-BATTLE scratch (LR2)': 'D-BATTLE のスクラッチ (LR2)',
  // Notes
  'Scroll (beatoraja)': 'スクロール (beatoraja)',
  'Scroll section lines': 'スクロール変化の小節数',
  'Scroll rate': 'スクロール変化の強さ',
  'Mines (beatoraja)': '地雷 (beatoraja)',
  'ANY KEY (PC)': 'ANY KEY (PC)',
  'Long notes': 'ロングノーツ',
  'EXTRA MODE (LR2)': 'EXTRA MODE (LR2)',
  'EXTRA minimum level (LR2)': 'EXTRA の最低レベル (LR2)',
  'EXTRA depth (beatoraja)': 'EXTRA の深さ (beatoraja)',
  'EXTRA scratch (beatoraja)': 'EXTRA のスクラッチ (beatoraja)',
  'Long-note add rate (beatoraja)': 'ロングノーツ追加率 (beatoraja)',
  // Hi-speed & view
  'HS-FIX': 'HS-FIX',
  'Display area info': '表示範囲の情報',
  'Effect 1P': 'エフェクト 1P',
  'Effect 2P': 'エフェクト 2P',
  'Lane cover': 'レーンカバー',
  'Cover height': 'カバーの高さ',
  'BPM GUIDE (beatoraja)': 'BPM GUIDE (beatoraja)',
  'BPM change warning (AC)': 'BPM 変化の警告 (AC)',
  'Auto scratch notes (AC)': 'オートスクラッチのノーツ (AC)',
  'LR2 mania options': 'LR2 マニアオプション',
  'GAMBOL (LR2)': 'GAMBOL (LR2)',
  'ACCELERATION (LR2)': 'ACCELERATION (LR2)',
  'EARTHQUAKE (LR2)': 'EARTHQUAKE (LR2)',
  'TORNADO (LR2)': 'TORNADO (LR2)',
  'SUPERLOOP (LR2)': 'SUPERLOOP (LR2)',
  'CHAR (LR2)': 'CHAR (LR2)',
  'HEARTBEAT (LR2)': 'HEARTBEAT (LR2)',
  'NABEATSU (LR2)': 'NABEATSU (LR2)',
  'SINCURVE (LR2)': 'SINCURVE (LR2)',
  'WAVE (LR2)': 'WAVE (LR2)',
  'SPIRAL effect (LR2)': 'SPIRAL effect (LR2)',
  'SIDEJUMP (LR2)': 'SIDEJUMP (LR2)',
  'LIFT 1P (beatoraja)': 'LIFT 1P (beatoraja)',
  'LIFT height 1P': 'LIFT の高さ 1P',
  'LIFT 2P (beatoraja)': 'LIFT 2P (beatoraja)',
  'LIFT height 2P': 'LIFT の高さ 2P',
  'Visual CONSTANT (beatoraja)': '見た目の CONSTANT (beatoraja)',
  'Note duration (ms)': 'ノーツの表示時間 (ms)',
  'CONSTANT fade (ms)': 'CONSTANT のフェード (ms)',
  'Normal HI-SPEED (AC 32 measured)': 'ノーマルハイスピード (AC 32 実測)',
  'Normal HS level': 'ノーマルハイスピードの段階',
  'Fixed display area (AC 34)': '表示範囲の固定 (AC 34)',
  'FLOATING HI-SPEED (AC 32 measured)': 'フローティングハイスピード (AC 32 実測)',
  'Floating speed': 'フローティングの速さ',
  'CLASSIC HI-SPEED': 'クラシックハイスピード',
  'Classic speed': 'クラシックの速さ',
  'Hi-speed': 'ハイスピード',
  // Practice
  PRACTICE: 'PRACTICE',
  'GAUGE VALUE': 'GAUGE VALUE',
  'JUDGERANK (0 = chart)': 'JUDGERANK (0 = 譜面の値)',
  'TOTAL (0 = chart)': 'TOTAL (0 = 譜面の値)',
  'GAUGE TYPE': 'GAUGE TYPE',
  'GAUGE CATEGORY': 'GAUGE CATEGORY',
  // Select
  Sort: '並び順',
  'Key filter': 'キー数の絞り込み',
  'Difficulty filter': '難易度の絞り込み',
  // Replay / ghost
  'SUDDEN+ / HIDDEN+': 'SUDDEN+ / HIDDEN+',
  LIFT: 'LIFT',
  Ghost: 'ゴースト',
  'Ghost mode': 'ゴーストの表示',
  'Ghost status': 'ゴーストの状態',
  'Ghost replay file…': 'ゴーストのリプレイファイル…',
  // Key config
  ...Object.fromEntries([
    ['1P scratch', '1P スクラッチ'],
    ['2P scratch', '2P スクラッチ'],
    ...[1, 2, 3, 4, 5, 6, 7].flatMap((key) => [
      [`1P key ${key}`, `1P 鍵盤 ${key}`],
      [`2P key ${key}`, `2P 鍵盤 ${key}`],
    ]),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((key) => [`Key ${key}`, `ボタン ${key}`]),
    ...['1P', '2P'].flatMap((side) => [
      [`${side} START`, `${side} START`],
      [`${side} SELECT`, `${side} SELECT`],
    ]),
  ]),
  'Built-in skin controls': '内蔵スキンの操作',
  Screens: '画面の操作',
  'Reset screen keys to defaults': '画面の操作を既定に戻す',
  ...ACTION_LABELS_JA,
  ...Object.fromEntries(
    CONTROL_ACTIONS.map((action) => [actionKeyConfigLabel(action), actionKeyConfigLabel(action, 'ja')]),
  ),
  'Reset keys to defaults': 'キーを既定に戻す',
  // Tempo & course
  Enabled: '有効',
  'Tempo (%)': 'テンポ (%)',
  Pitch: 'ピッチ',
  'Keep-pitch stretcher': 'ピッチを保つ伸縮方式',
  'Skip stage results': 'ステージのリザルトを飛ばす',
  'My courses…': 'マイコース…',
  'NONSTOP placement': 'NONSTOP の配置',
  'Table URL': '難易度表の URL',
  'Import table courses': '難易度表のコースを読み込む',
  // Skin & display
  'Skin system': 'スキンの種類',
  'Built-in skin': '内蔵スキン',
  'Skin effects': 'スキンの演出',
  'Load LR2 skin…': 'LR2 スキンを読み込む…',
  'LR2 theme': 'LR2 テーマ',
  'Load beatoraja skin…': 'beatoraja スキンを読み込む…',
  'Skin module URL': 'スキンモジュールの URL',
  'Add from URL': 'URL から追加',
  'Render resolution': '描画解像度',
  'Renderer (applies on reload)': 'レンダラー (再読み込みで反映)',
  'Auto-detect resolution': '解像度を自動で決める',
  'Play layout': 'プレイ画面のレイアウト',
  'Judged notes': '判定後のノーツ',
  'Toggle fullscreen': '全画面の切り替え',
  // BGA camera
  'Show camera in BGA': 'BGA の枠にカメラを映す',
  Camera: 'カメラ',
  'Allow camera access': 'カメラへのアクセスを許可',
  'Mirror camera': 'カメラを左右反転',
  'Preview camera': 'カメラをプレビュー',
  'Stop preview': 'プレビューを止める',
  'Reset to defaults': '既定に戻す',
  // Audio
  Mute: 'ミュート',
  'Master (%)': '全体 (%)',
  'Key sound (%)': 'キー音 (%)',
  'BGM (%)': 'BGM (%)',
  'Silent switch': '消音スイッチ',
  'Peak gain (next play)': 'ピークゲイン (次のプレイから)',
  Key: 'キー音',
  BGM: 'BGM',
  Master: '全体',
  'Threshold (dB)': 'しきい値 (dB)',
  'Knee (dB)': 'ニー (dB)',
  'Ratio (x:1)': 'レシオ (x:1)',
  'Attack (ms)': 'アタック (ms)',
  'Release (ms)': 'リリース (ms)',
  'Reset to default': '既定に戻す',
  // Library
  Status: '状態',
  'Open folder': 'フォルダを開く',
  'Open files (ZIP / replay)': 'ファイルを開く (ZIP / リプレイ)',
  'Music ZIP URL': '楽曲 ZIP の URL',
  'Skin ZIP URL': 'スキン ZIP の URL',
  'Load from URLs': 'URL から読み込む',
  'Auto-save replays': 'リプレイの自動保存',
  'Slot 1 auto-save': 'スロット 1 の自動保存',
  'Slot 2 auto-save': 'スロット 2 の自動保存',
  'Slot 3 auto-save': 'スロット 3 の自動保存',
  'Slot 4 auto-save': 'スロット 4 の自動保存',
  'Clear best records': 'ベスト記録を消す',
  'Local data…': '保存データ…',
  'Use WebCodecs encoder': 'WebCodecs のエンコーダーを使う',
  Resize: '縮小',
  '● Record gameplay video': '● プレイ動画を録画',
  'Video format': '動画の形式',
  '📸 Screenshot': '📸 スクリーンショット',
  // Leaderboard
  'Submit to Leaderboard': 'Leaderboard に送信',
  'Submit when': '送信する条件',
  'EX-SCORE improves (first play always)': 'EX-SCORE 更新時 (初回は必ず)',
  Always: '毎回',
  Account: 'アカウント',
  'Keep this account': 'このアカウントを保存',
  'Sign in': 'ログイン',
  'Sign out': 'ログアウト',
  // Developer
  'CPU workers': 'CPU ワーカー数',
  'Judgment windows': '判定ルール',
  'Auto pause on blur': 'フォーカスが外れたら一時停止',
  'Show invisible notes': '不可視ノーツを表示',
  FPS: 'FPS',
  'Reset settings and reload': '設定をリセットして再読み込み',
};

/** `label` as the dialog shows it in `lang`: the Japanese table's text in Japanese, else `label` itself. */
export function optionLabel(label: string, lang: string): string {
  return lang === 'ja' ? (OPTION_LABELS_JA[label] ?? label) : label;
}

/** A label's text and the source it names in parentheses at its end, which the dialog shows as a badge. */
export interface OptionLabelParts {
  readonly text: string;
  readonly source?: string;
}

const LABEL_SOURCE = /^(.*\S) \(((?:LR2|beatoraja|PC|AC)(?: [^();]*)?)\)$/u;

/**
 * Splits the source off the end of a label as the dialog shows it: `Scroll (beatoraja)` reads `Scroll` with a
 * `beatoraja` badge, `Normal HI-SPEED (AC 32 measured)` `Normal HI-SPEED` with `AC 32 measured`. A note in parentheses
 * that is not a source alone (`Fixed key 1P (LR2; 0=default)`, `Seed 1P (-1=random)`) stays in the text.
 */
export function splitOptionLabelSource(label: string): OptionLabelParts {
  const match = LABEL_SOURCE.exec(label);
  return match === null ? { text: label } : { text: match[1]!, source: match[2]! };
}

/** Ask the owner of the options tree to render its labels in the chosen language. */
export function relabelOptions(root: { relabel(language: string): void }, lang: string): void {
  root.relabel(lang);
}
