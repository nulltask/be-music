# be-music

TypeScript + npm workspaces で構成した BMS/BMSON ツールチェーンです。

## パッケージ

- `@be-music/json`: BMS/BMSON 中間表現 (JSON互換) の型と共通ユーティリティ
- `@be-music/utils`: 全パッケージで再利用する汎用ユーティリティ
- `@be-music/parser`: `.bms` / `.bmson` / JSON のパーサ
- `@be-music/stringifier`: JSON から `.bms` / `.bmson` への文字列化
- `@be-music/audio-renderer`: 譜面をレンダリングして `.wav` / `.aiff` を出力
- `@be-music/player`: CLI プレイヤー (オートプレイ / キーボード演奏)
- `@be-music/editor`: CLI エディタ (インポート・編集・エクスポート)

## セットアップ

```bash
npm install
```

## ビルド

```bash
npm run build
```

`npm run build` は各ワークスペースを依存順で `vite build` し、続けて型定義 (`.d.ts`) を出力します。

## TypeScript 設定

- `tsconfig.json`: ソリューション設定（project references 管理、`togo -b` 用）
- `tsconfig.options.json`: 共通 compiler options
- `tsconfig.dev.json`: 開発実行用（`tsx` 向け `paths` 解決）

## Lint / Format

```bash
# Lint
npm run lint
npm run lint:fix

# Format
npm run format
npm run format:check

# Test
npm run test
```

`vitest` で `packages/*/src/**/*.test.ts` を実行します（テストファイルは対象実装と同じディレクトリに配置）。

## parser ベンチマーク

`parser` のパース性能退行を確認するためのベンチマークを用意しています。

```bash
# 1) 基準値を更新（初回 or 意図的に更新する時）
npm run bench:parser:update-baseline

# 2) 変更後の退行チェック（しきい値超過で失敗）
npm run bench:parser:check

# 3) 単純計測（失敗判定なし）
npm run bench:parser
```

- 既定では `examples` 配下の譜面からサイズ上位ファイルを選び、`parseChart`（in-memory）と `parseChartFile`（read+parse）を計測します。
- ベースラインは `tmp/parser-benchmark-baseline.json` に保存されます。
- `bench:parser:check` は平均時間が既定しきい値（`+50%`）を超えると失敗します。

## 仕様書

- [BMS / BMSON 仕様書リンク](./docs/README.md)

## 対応状況 (機能別)

一次参照に対して、現状はいずれも「部分対応」です。

### BMS 対応状況サマリ

- 対応レベル: 部分対応
- [x] parser: `#mmmcc:data` / `#COMMAND value` を読み込み
- [x] parser: 主要ヘッダ/リソース (`TITLE`, `ARTIST`, `BPM`, `WAVxx`, `BMPxx`, `BPMxx`, `STOPxx`, `TEXTxx`) を解釈
- [x] parser: 小節長/BPM/STOP/背景音/演奏チャンネル (`02`, `03`, `08`, `09`, `01`, `1x`/`2x`) を解釈
- [x] parser: BMS テキストの文字コード推測 (Shift_JIS, UTF-8, EUC-JP, latin1 など)
- [x] parser: 制御構文 (`#RANDOM`, `#IF`, `#ELSEIF`, `#ELSE`, `#ENDIF`, `#SETRANDOM`, `#ENDRANDOM`, `#SWITCH`, `#CASE`, `#SKIP`, `#DEF`, `#SETSWITCH`, `#ENDSW`) の保持
- [x] player / audio-renderer: 制御構文の実行時評価
- [x] parser / stringifier: 拡張ヘッダ (`#LNTYPE`, `#LNOBJ`, `#DEFEXRANK`, `#EXRANKxx`, `#ARGBxx`, `#PLAYER`, `#PATH_WAV`, `#BASEBPM`, `#STP`, `#OPTION`, `#CHANGEOPTIONxx`, `#WAVCMD`, `#EXWAVxx`, `#EXBMPxx`, `#BGAxx`, `#POORBGA`, `#SWBGAxx`, `#VIDEOFILE`, `#MATERIALS`, `#DIVIDEPROP`, `#CHARSET`) の保持と書き出し
- [x] player / audio-renderer: 小節長/BPM/STOP を反映した再生
- [x] player / audio-renderer: 同一定義番号の再トリガで先行音を即カット
- [x] player: `#LNOBJ` によるロングノート終端判定
- [x] 拡張ヘッダの専用解釈 (`#PLAYER`, `#PATH_WAV`, `#BASEBPM`, `#STP`, `#OPTION`, `#CHANGEOPTIONxx`, `#WAVCMD`, `#EXWAVxx`, `#EXBMPxx`, `#BGAxx`, `#POORBGA`, `#SWBGAxx`, `#VIDEOFILE`, `#MATERIALS`, `#DIVIDEPROP`, `#CHARSET` など)
- [ ] 拡張チャンネルの専用挙動 (`#xxx51-69` (LN), `#xxxD1-E9` (地雷) など)
- [ ] 動画 BGA 再生
- 詳細: [`docs/bms-spec.md`](./docs/bms-spec.md)

### BMSON 対応状況サマリ

- 対応レベル: 部分対応
- [x] parser: `version` / `info` / `lines` / `sound_channels` / `bpm_events` / `stop_events` / `bga` / `notes.l/c` を読み込み
- [x] stringifier: 上記主要要素の書き出し (`lines` 自動生成含む)
- [x] player / audio-renderer: `lines` / `resolution` / `bpm_events` / `stop_events` / `notes.l/c` を使った再生
- [ ] 未知ルートキーの透過保持
- [ ] `bga_events` / `layer_events` / `poor_events` の再生反映
- [ ] 動画 BGA 再生
- 詳細: [`docs/bmson-spec.md`](./docs/bmson-spec.md)

### parser (`@be-music/parser`)

- [x] BMS の `#mmmcc:data` / `#COMMAND value` を読み込み
- [x] BMS の主要ヘッダ/リソース (`TITLE`, `ARTIST`, `BPM`, `WAVxx`, `BMPxx`, `STOPxx` など) を解釈
- [x] BMS の小節長/BPM/STOP/背景音/演奏チャンネル (`02`, `03`, `08`, `09`, `01`, `1x`/`2x`) を解釈
- [x] BMS テキストの文字コード推測 (Shift_JIS, UTF-8, EUC-JP, latin1 など)
- [x] BMSON の基本要素 (`info`, `sound_channels`, `bpm_events`, `stop_events`) を読み込み
- [x] BMSON の `version` / `lines` / `info.resolution` を読み込み
- [x] BMSON の `bga` / `info` 拡張項目 / `notes.l/c` を読み込み
- [x] BMS 制御構文 (`#RANDOM`, `#IF`, `#ELSEIF`, `#ELSE`, `#ENDIF`, `#SETRANDOM`, `#ENDRANDOM`, `#SWITCH`, `#CASE`, `#SKIP`, `#DEF`, `#SETSWITCH`, `#ENDSW`) の保持と実行時評価
- [x] BMS 拡張仕様 (`#LNTYPE`, `#LNOBJ`, `#EXRANKxx`, `#ARGBxx` など) の専用解釈
- [x] BMSON の厳密準拠 (`bga`, `info` 拡張項目, `notes.l/c` など)

### stringifier (`@be-music/stringifier`)

- [x] 中間表現(JSON) -> BMS の書き出し
- [x] 分数位置 `position: [numerator, denominator]` を使った小節解像度生成
- [x] 中間表現(JSON) -> BMSON の基本書き出し (`sound_channels`, `bpm_events`, `stop_events`)
- [x] BMSON の `notes.l/c` を保持して書き出し (未指定時は `l=0`, `c=false`)
- [x] BMSON の `version` / `lines` / `info.resolution` を書き出し
- [x] BMSON の `bga` / `info` 拡張項目の完全書き出し

### audio-renderer (`@be-music/audio-renderer`)

- [x] BMS / BMSON / JSON 入力に対応
- [x] 出力形式 `.wav` / `.aiff` に対応
- [x] サンプル読込 `WAV` (RIFF/WAVE) / `MP3` / `OGG` (Vorbis/Opus) / `OPUS` に対応
- [x] 小節長/BPM/STOP を使ったタイミング解決
- [ ] BGA/動画を含む映像レンダリング出力

### player (`@be-music/player`)

- [x] オートプレイ
- [x] キーボード手動演奏
- [x] 手動時は演奏チャンネルをキー押下時のみ発音 (背景音チャンネルは自動再生)
- [x] BGM 音量調整 (`--bgm-volume`) / 無音化 (`0`)
- [x] TUI プレイ画面 (判定、進行バー、小節線、チャンネル配列表示、直近判定 `GREAT` / `GOOD` / `BAD` / `MISS`、コンボ数表示。PGREAT は虹色 `GREAT` を点滅表示)
- [x] BGA 表示 (ANSI Color)
- [x] Sixel 対応端末での BGA 画像表示 (非対応端末は ANSI Color にフォールバック)
- [ ] 動画 BGA の再生

### editor (`@be-music/editor`)

- [x] `import` (BMS/BMSON -> JSON)
- [x] `export` (JSON -> BMS/BMSON)
- [x] `set-meta`
- [x] `add-note` / `delete-note` / `list-notes`
- [x] `init` (空の JSON 初期化)

詳細は `docs` の実装仕様を参照してください。

## 主要コマンド

### 1. BMS/BMSON を JSON に変換

```bash
npm run parse -- chart.bms chart.json
```

### 2. JSON を BMS に変換

```bash
npm run stringify -- chart.json chart.bms --format bms
```

### 3. 音声レンダリング

```bash
npm run audio-render -- chart.bms out.wav
npm run audio-render -- chart.bms out.aiff --sample-rate 48000
```

### 4. プレイヤー

```bash
# オートプレイ
npm run player -- chart.bms --auto

# 手動演奏
npm run player -- chart.bms

# TUI 画面を無効化
npm run player -- chart.bms --no-tui

# 音声レイテンシ補正 (例: +35ms)
npm run player -- chart.bms --audio-offset-ms 35

# 曲頭欠け対策の無音パディング調整 (例: 180ms)
npm run player -- chart.bms --audio-head-padding-ms 180

# 音声再生を無効化
npm run player -- chart.bms --no-audio

# 音声バックエンドを指定 (auto | speaker | audify | audio-io)
npm run player -- chart.bms --audio-backend audio-io
```

### 5. エディタ

```bash
# インポート
npm run editor -- import chart.bms chart.json

# ノート追加
npm run editor -- add-note chart.json 0 11 1 2 01

# エクスポート
npm run editor -- export chart.json chart.bms
```

## 実装メモ

- 内部データモデルは `@be-music/json` を BMS/BMSON 中間表現(IR)として使用し、`bmson` は入出力フォーマットとして扱います。
- BMS/BMSON 中間表現のイベント位置は `position: [numerator, denominator]` の分数タプルで保持します。
- BMS 制御構文は `bms.controlFlow` として IR に保持し、`player`/`audio-renderer` は実行時に分岐を評価します（パース時には確定しません）。
- 仕様差分や拡張要素は、`@be-music/json` 側を拡張して吸収します（`bmson` を唯一の内部表現にはしません）。
- 汎用処理 (CLI パス解決、数値クランプ、整数演算) は `@be-music/utils` に集約しています。
- `audio-renderer` のサンプル読込は `WAV` (RIFF/WAVE), `MP3`, `OGG` (Vorbis/Opus), `OPUS` に対応しています。
- `#WAVxx` の探索順は、拡張子未指定時 `wav -> mp3 -> ogg -> opus`、`.wav` 指定時 `wav -> mp3 -> ogg -> opus`、`.mp3` 指定時 `mp3 -> ogg -> opus`、`.ogg/.oga` 指定時 `ogg/oga -> opus`、`.opus` 指定時 `opus -> ogg/oga` です。
- `player` は TUI プレイ画面付きの CLI です。音声再生は `--audio-backend` で `speaker` / `audify` / `audio-io` を選択でき、未指定時は `auto` で利用可能な実装へフォールバックします（外部コマンド起動なし）。
- `player` の手動演奏では、演奏チャンネルはキー押下時のみ発音します（背景系チャンネルのみ自動再生）。
- `player` の標準チャンネル順とキー割り当ては IIDX 配列（1P/2P）です。2P チャンネルがある場合、TUI は 1P/2P 間にスペースを入れて表示します。
- `player` の TUI では、直近判定を `GREAT` / `GOOD` / `BAD` / `MISS` で表示し、コンボ数（`> 0` のときのみ）をレーン下端と入力キー行の間に中央揃えで表示します。PGREAT（内部判定は `PERFECT`）は虹色 `GREAT` の点滅表示です。
- `player` は IIDX 準拠を優先し、通常時の判定幅は固定です。`--debug-judge-window <ms>` はデバッグ専用の隠しオプションとしてのみ受け付けます（`--judge-window` は後方互換のため非推奨サポート）。
- `player` の BGA は `04`(base) と `07`(layer) を重ねて描画し、layer は黒を透過として扱います。画像は 256x256 キャンバス前提で、256x256 未満は X 中央・Y 上詰めで配置します。
- `parser` は BMS テキスト読込時に文字コードを推測し、Shift_JIS などのマルチバイト入力を扱います。
- `#LNTYPE` / `#LNOBJ` / `#DEFEXRANK` / `#EXRANKxx` / `#ARGBxx` は `bms` 拡張領域に専用フィールドとして保持します。
- `bmson` の `info` 拡張項目 (`subartists`, `chart_name`, `judge_rank`, `total`, 画像/プレビュー系) と `bga`、`notes.l/c` は `bmson` / `events[].bmson` 拡張領域で保持します。
- `examples/test/control-flow-test.bms` は `#SETRANDOM` / `#SETSWITCH` を使った決定論的テスト用です。
- `examples/test/control-flow-random-demo.bms` は分岐ごとにノート数・チャンネル・BGMを大きく変えたランダム挙動確認用です。
- `examples/test/retrigger-same-key-cut.bms` は同一定義番号の再トリガで先行音をカットする挙動確認用、`examples/test/retrigger-different-key-overlap.bms` は同一ファイルでも別定義番号なら重なる挙動確認用です（`retrigger_a.wav`, `retrigger_b.wav` を使用）。
- 仕様全域の完全対応ではなく、拡張しやすい基盤実装を優先しています。
