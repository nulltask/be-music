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
- [x] parser: オブジェクトデータ行 `#mmmcc:data` を読み込み
- [x] parser: ヘッダ行 `#COMMAND value` を読み込み
- [x] parser: ヘッダ `#TITLE` を解釈
- [x] parser: ヘッダ `#ARTIST` を解釈
- [x] parser: ヘッダ `#BPM` を解釈
- [x] parser: リソース `#WAVxx` を解釈
- [x] parser: リソース `#BMPxx` を解釈
- [x] parser: リソース `#BPMxx` を解釈
- [x] parser: リソース `#STOPxx` を解釈
- [x] parser: リソース `#TEXTxx` を解釈
- [x] parser: チャンネル `02` (小節長) を解釈
- [x] parser: チャンネル `03` (16進直値 BPM) を解釈
- [x] parser: チャンネル `08` (`#BPMxx` 参照 BPM) を解釈
- [x] parser: チャンネル `09` (`#STOPxx` 参照 STOP) を解釈
- [x] parser: チャンネル `01` (背景音) を解釈
- [x] parser: チャンネル `1x` / `2x` (演奏) を解釈
- [x] parser: BMS テキストの文字コード推測 (Shift_JIS, UTF-8, EUC-JP, latin1 など)
- [x] parser: 制御構文 `#RANDOM` を保持
- [x] parser: 制御構文 `#SETRANDOM` を保持
- [x] parser: 制御構文 `#ENDRANDOM` を保持
- [x] parser: 制御構文 `#IF` を保持
- [x] parser: 制御構文 `#ELSEIF` を保持
- [x] parser: 制御構文 `#ELSE` を保持
- [x] parser: 制御構文 `#ENDIF` を保持
- [x] parser: 制御構文 `#SWITCH` を保持
- [x] parser: 制御構文 `#SETSWITCH` を保持
- [x] parser: 制御構文 `#CASE` を保持
- [x] parser: 制御構文 `#DEF` を保持
- [x] parser: 制御構文 `#SKIP` を保持
- [x] parser: 制御構文 `#ENDSW` を保持
- [x] player / audio-renderer: 制御構文 `#RANDOM` / `#SETRANDOM` / `#ENDRANDOM` を実行時評価
- [x] player / audio-renderer: 制御構文 `#IF` / `#ELSEIF` / `#ELSE` / `#ENDIF` を実行時評価
- [x] player / audio-renderer: 制御構文 `#SWITCH` / `#SETSWITCH` / `#CASE` / `#DEF` / `#SKIP` / `#ENDSW` を実行時評価
- [x] parser / stringifier: 拡張ヘッダ `#PREVIEW` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#LNTYPE` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#LNMODE` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#LNOBJ` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#VOLWAV` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#DEFEXRANK` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#EXRANKxx` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#ARGBxx` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#PLAYER` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#PATH_WAV` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#BASEBPM` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#STP` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#OPTION` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#CHANGEOPTIONxx` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#WAVCMD` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#EXWAVxx` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#EXBMPxx` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#BGAxx` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#SCROLLxx` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#POORBGA` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#SWBGAxx` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#VIDEOFILE` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#MATERIALS` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#DIVIDEPROP` の保持と書き出し
- [x] parser / stringifier: 拡張ヘッダ `#CHARSET` の保持と書き出し
- [x] player / audio-renderer: チャンネル `02` (小節長) を再生タイミングへ反映
- [x] player / audio-renderer: チャンネル `03` (16進直値 BPM) を再生タイミングへ反映
- [x] player / audio-renderer: チャンネル `08` (`#BPMxx` 参照 BPM) を再生タイミングへ反映
- [x] player / audio-renderer: チャンネル `09` (`#STOPxx` 参照 STOP) を再生タイミングへ反映
- [x] player / audio-renderer: 同一定義番号の再トリガで先行音を即カット
- [x] player: `#LNOBJ` によるロングノート終端判定
- [x] player: 拡張ヘッダ `#PREVIEW` を曲選択プレビュー再生で優先使用
- [x] player / audio-renderer: 拡張ヘッダ `#VOLWAV` を再生ゲインに反映
- [ ] 拡張チャンネル `#xxx51-59` (LN: `LNTYPE=1`) の専用挙動
- [ ] 拡張チャンネル `#xxx61-69` (LN: `LNTYPE=2`) の専用挙動
- [ ] 動画 BGA 再生
- 詳細: [`docs/bms-spec.md`](./docs/bms-spec.md)

### BMSON 対応状況サマリ

- 対応レベル: 部分対応
- [x] parser: ルート `version` を読み込み
- [x] parser: ルート `info` を読み込み
- [x] parser: ルート `lines` を読み込み
- [x] parser: ルート `sound_channels` を読み込み
- [x] parser: ルート `bpm_events` を読み込み
- [x] parser: ルート `stop_events` を読み込み
- [x] parser: ルート `bga` を読み込み
- [x] parser: `notes.l` を読み込み
- [x] parser: `notes.c` を読み込み
- [x] stringifier: `version` を書き出し
- [x] stringifier: `info` を書き出し
- [x] stringifier: `lines` を書き出し
- [x] stringifier: `lines` を自動生成して書き出し
- [x] stringifier: `sound_channels` を書き出し
- [x] stringifier: `bpm_events` を書き出し
- [x] stringifier: `stop_events` を書き出し
- [x] stringifier: `bga` を書き出し
- [x] stringifier: `notes.l` を書き出し
- [x] stringifier: `notes.c` を書き出し
- [x] player / audio-renderer: `lines` を使った時刻解決
- [x] player / audio-renderer: `resolution` を使った時刻解決
- [x] player / audio-renderer: `bpm_events` を使った時刻解決
- [x] player / audio-renderer: `stop_events` を使った時刻解決
- [x] player / audio-renderer: `notes.l` を使ったロングノート解釈
- [x] player / audio-renderer: `notes.c` を使った継続発音オフセット解釈
- [ ] 未知ルートキーの透過保持
- [ ] `bga_events` の再生反映
- [ ] `layer_events` の再生反映
- [ ] `poor_events` の再生反映
- [ ] 動画 BGA 再生
- 詳細: [`docs/bmson-spec.md`](./docs/bmson-spec.md)

### parser (`@be-music/parser`)

- [x] BMS の `#mmmcc:data` を読み込み
- [x] BMS の `#COMMAND value` を読み込み
- [x] BMS ヘッダ `#TITLE` を解釈
- [x] BMS ヘッダ `#ARTIST` を解釈
- [x] BMS ヘッダ `#BPM` を解釈
- [x] BMS リソース `#WAVxx` を解釈
- [x] BMS リソース `#BMPxx` を解釈
- [x] BMS リソース `#STOPxx` を解釈
- [x] BMS チャンネル `02` (小節長) を解釈
- [x] BMS チャンネル `03` (16進直値 BPM) を解釈
- [x] BMS チャンネル `08` (`#BPMxx` 参照 BPM) を解釈
- [x] BMS チャンネル `09` (`#STOPxx` 参照 STOP) を解釈
- [x] BMS チャンネル `01` (背景音) を解釈
- [x] BMS チャンネル `1x` / `2x` (演奏) を解釈
- [x] BMS テキストの文字コード推測 (Shift_JIS, UTF-8, EUC-JP, latin1 など)
- [x] BMSON ルート `info` を読み込み
- [x] BMSON ルート `sound_channels` を読み込み
- [x] BMSON ルート `bpm_events` を読み込み
- [x] BMSON ルート `stop_events` を読み込み
- [x] BMSON ルート `version` を読み込み
- [x] BMSON ルート `lines` を読み込み
- [x] BMSON `info.resolution` を読み込み
- [x] BMSON ルート `bga` を読み込み
- [x] BMSON `info` 拡張項目を読み込み
- [x] BMSON `notes.l` を読み込み
- [x] BMSON `notes.c` を読み込み
- [x] BMS 制御構文 `#RANDOM` / `#SETRANDOM` / `#ENDRANDOM` を保持して評価
- [x] BMS 制御構文 `#IF` / `#ELSEIF` / `#ELSE` / `#ENDIF` を保持して評価
- [x] BMS 制御構文 `#SWITCH` / `#SETSWITCH` / `#CASE` / `#DEF` / `#SKIP` / `#ENDSW` を保持して評価
- [x] BMS 拡張ヘッダ `#PREVIEW` を専用解釈
- [x] BMS 拡張ヘッダ `#LNTYPE` を専用解釈
- [x] BMS 拡張ヘッダ `#LNMODE` を専用解釈
- [x] BMS 拡張ヘッダ `#LNOBJ` を専用解釈
- [x] BMS 拡張ヘッダ `#VOLWAV` を専用解釈
- [x] BMS 拡張ヘッダ `#EXRANKxx` を専用解釈
- [x] BMS 拡張ヘッダ `#ARGBxx` を専用解釈
- [x] BMS 拡張ヘッダ `#SCROLLxx` を専用解釈
- [x] BMSON `bga` を厳密準拠で保持
- [x] BMSON `info` 拡張項目を厳密準拠で保持
- [x] BMSON `notes.l/c` を厳密準拠で保持

### stringifier (`@be-music/stringifier`)

- [x] 中間表現(JSON) -> BMS の書き出し
- [x] 分数位置 `position: [numerator, denominator]` を使った小節解像度生成
- [x] 中間表現(JSON) -> BMSON の `sound_channels` を書き出し
- [x] 中間表現(JSON) -> BMSON の `bpm_events` を書き出し
- [x] 中間表現(JSON) -> BMSON の `stop_events` を書き出し
- [x] BMSON の `notes.l` を保持して書き出し (未指定時は `l=0`)
- [x] BMSON の `notes.c` を保持して書き出し (未指定時は `c=false`)
- [x] BMSON の `version` を書き出し
- [x] BMSON の `lines` を書き出し
- [x] BMSON の `info.resolution` を書き出し
- [x] BMSON の `bga` を完全書き出し
- [x] BMSON の `info` 拡張項目を完全書き出し

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
- [x] TUI プレイ画面 (判定、進行バー、小節線、チャンネル配列表示、直近判定 `GREAT` / `GOOD` / `BAD` / `POOR`、コンボ数表示、EX-SCORE / SCORE 表示。PGREAT は虹色 `GREAT` を点滅表示)
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

# スクラッチのみオート (16ch/26ch)
npm run player -- chart.bms --auto-scratch

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

# 出力リミッタを無効化 (既定は ON)
npm run player -- chart.bms --no-limiter

# コンプレッサを有効化して音圧高めの譜面を調整
npm run player -- chart.bms --compressor --compressor-threshold-db -10 --compressor-ratio 3

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
- `player` の TUI では、直近判定を `GREAT` / `GOOD` / `BAD` / `POOR` で表示し、コンボ数（`> 0` のときのみ）をレーン下端と入力キー行の間に中央揃えで表示します。PGREAT（内部判定は `PERFECT`）は虹色 `GREAT` の点滅表示です。
- `player` は IIDX 準拠の `EX-SCORE` (`PGREAT=2`, `GREAT=1`) と 20万点満点 `SCORE`（判定基礎点 15万 + コンボ点 5万）を集計して表示します。
- `player` は IIDX 準拠を優先し、通常時の判定幅は固定です。`--debug-judge-window <ms>` はデバッグ専用の隠しオプションとしてのみ受け付けます（`--judge-window` は後方互換のため非推奨サポート）。
- `player` の BGA は `04`(base) と `07`(layer) を重ねて描画し、layer は黒を透過として扱います。画像は 256x256 キャンバス前提で、256x256 未満は X 中央・Y 上詰めで配置します。
- `parser` は BMS テキスト読込時に文字コードを推測し、Shift_JIS などのマルチバイト入力を扱います。
- `#PREVIEW` / `#LNTYPE` / `#LNMODE` / `#LNOBJ` / `#VOLWAV` / `#DEFEXRANK` / `#EXRANKxx` / `#ARGBxx` / `#SCROLLxx` は `bms` 拡張領域に専用フィールドとして保持します。
- `bmson` の `info` 拡張項目 (`subartists`, `chart_name`, `judge_rank`, `total`, 画像/プレビュー系) と `bga`、`notes.l/c` は `bmson` / `events[].bmson` 拡張領域で保持します。
- `examples/test/control-flow-test.bms` は `#SETRANDOM` / `#SETSWITCH` を使った決定論的テスト用です。
- `examples/test/control-flow-random-demo.bms` は分岐ごとにノート数・チャンネル・BGMを大きく変えたランダム挙動確認用です。
- `examples/test/retrigger-same-key-cut.bms` は同一定義番号の再トリガで先行音をカットする挙動確認用、`examples/test/retrigger-different-key-overlap.bms` は同一ファイルでも別定義番号なら重なる挙動確認用です（`retrigger_a.wav`, `retrigger_b.wav` を使用）。
- 仕様全域の完全対応ではなく、拡張しやすい基盤実装を優先しています。
