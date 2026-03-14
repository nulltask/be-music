# be-music

TypeScript + pnpm workspaces で構成した BMS/BMSON ツールチェーンです。

## パッケージ

- `@be-music/json`: Be-Music 内部処理専用の BMS/BMSON 中間表現 (JSON互換) の pure IR
- `@be-music/chart`: beat 解決、イベント順序、ロングノート解決などの譜面意味論 helper
- `@be-music/utils`: 全パッケージで再利用する汎用ユーティリティ
- `@be-music/parser`: `.bms` / `.bme` / `.bml` / `.pms` / `.bmson` / JSON のパーサ
- `@be-music/stringifier`: JSON から `.bms` / `.bmson` への文字列化
- `@be-music/audio-renderer`: 譜面をレンダリングして `.wav` / `.aiff` を出力
- `@be-music/player`: CLI プレイヤー (オートプレイ / キーボード演奏 / TUI)
- `@be-music/editor`: CLI エディタ (インポート・編集・エクスポート)

## 必要環境

- Node.js `>= 22`
- pnpm workspaces

## セットアップ

```bash
pnpm install
```

## ビルド・検証

```bash
pnpm run clean
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run test
```

`pnpm run build` は各ワークスペースの `tsdown` build を依存関係を満たしながら並列実行し、bundle と型定義 (`.d.ts`) をまとめて出力します。`pnpm run typecheck` / `pnpm run lint` / `pnpm run format` もワークスペース単位で並列実行します。

## 仕様書

- [仕様書トップ](./docs/README.md)
- [BMS 実装仕様](./docs/bms-spec.md)
- [BMSON 実装仕様](./docs/bmson-spec.md)
- [Bemuse 実装仕様](./docs/bemuse-spec.md)
- [BMS/BMSON 中間表現 (`@be-music/json`) 実装仕様](./docs/json-spec.md)

`@be-music/json` は Be-Music の内部データモデルです。配布フォーマットや他ツールとの再利用可能な交換フォーマットとしては設計していません。
譜面の意味論 helper は `@be-music/chart` に分離しており、`@be-music/json` 自体は pure IR と round-trip preservation を担当します。

## 対応状況サマリ

### parser (`@be-music/parser`)

- BMS のヘッダ / オブジェクト行 / 制御構文を保持
- `#WAVxx` / `#BMPxx` / `#BPMxx` / `#STOPxx` / `#TEXTxx` を解釈
- BMS 拡張ヘッダ (`#PREVIEW`, `#LNTYPE`, `#LNMODE`, `#LNOBJ`, `#VOLWAV`, `#SCROLLxx`, `#VIDEOFILE` など) を保持
- BMSON の `info` / `lines` / `sound_channels` / `bpm_events` / `stop_events` / `bga` を解釈
- BMS テキストの文字コード推測 (`Shift_JIS`, `UTF-8`, `EUC-JP`, `latin1` など)

### stringifier (`@be-music/stringifier`)

- 中間表現(JSON) から BMS/BMSON を出力
- `position: [numerator, denominator]` を使って小節解像度を安定再現
- BMSON 拡張情報 (`info` 拡張, `bga`, `notes.l/c`) を出力

### audio-renderer (`@be-music/audio-renderer`)

- BMS / BMSON / JSON 入力に対応
- 出力形式 `.wav` / `.aiff`
- サンプル読込: `WAV` / `MP3` / `OGG` (Vorbis/Opus) / `OPUS`
- 小節長 / BPM / STOP を反映
- LR2 系の 100001 倍 BPM ギミック値を時刻解決で処理

### player (`@be-music/player`)

- MANUAL / AUTO SCRATCH / AUTO の 3 モード
- TUI プレイ画面と選曲画面
- 選曲画面の metadata / preview / banner 表示
- HIGH-SPEED (`0.5` 〜 `10.0`, `0.5` 刻み)
- TUI refresh rate 設定 (`--tui-fps`, default `60`)
- 判定: `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR`（`FAST` / `SLOW` 集計あり）
- 20 万点満点 SCORE と IIDX 準拠 EX-SCORE
- 不可視ノート表示 (`--show-invisible-notes`)
- FREE ZONE (`17` / `27`) の専用扱い
- BGA 画像描画 (`BMP` / `PNG` / `JPEG`) と動画描画 (`mpeg1video` / `h264`)
- `--kitty-graphics` による opt-in の Kitty graphics protocol 描画
- `node-web-audio-api` 固定バックエンドで再生

### editor (`@be-music/editor`)

- `init`, `import`, `export`, `set-meta`, `add-note`, `delete-note`, `list-notes`

## 主要コマンド

### 1. BMS/BMSON を JSON に変換

```bash
pnpm run parse chart.bms chart.json
```

### 2. JSON を BMS/BMSON に変換

```bash
pnpm run stringify chart.json chart.bms --format bms
pnpm run stringify chart.json chart.bmson --format bmson
```

### 3. 音声レンダリング

```bash
pnpm run audio-render chart.bms out.wav
pnpm run audio-render chart.bms out.aiff --sample-rate 48000
```

### 4. プレイヤー

```bash
# オートプレイ
pnpm run player chart.bms --auto

# スクラッチのみオート (16ch/26ch)
pnpm run player chart.bms --auto-scratch

# 手動演奏
pnpm run player chart.bms

# TUI 無効
pnpm run player chart.bms --no-tui

# HIGH-SPEED 初期値
pnpm run player chart.bms --high-speed 3.5

# TUI refresh rate
pnpm run player chart.bms --tui-fps 120

# 不可視チャンネル (31-39/41-49) を緑ノートで表示
pnpm run player chart.bms --show-invisible-notes

# Kitty graphics protocol を使って BGA / STAGEFILE / BANNER を画像表示
pnpm run player chart.bms --kitty-graphics

# 音声オフ
pnpm run player chart.bms --no-audio

# 出力リミッタを無効化
pnpm run player chart.bms --no-limiter

# コンプレッサを有効化
pnpm run player chart.bms --compressor --compressor-threshold-db -10 --compressor-ratio 3
```

### 5. エディタ

```bash
pnpm run editor import chart.bms chart.json
pnpm run editor add-note chart.json 0 11 1 2 01
pnpm run editor export chart.json chart.bms
```

## player 操作

### 選曲画面

- `↑/↓` or `k/j`: 移動
- `←/→` or `h/l`: ページ移動
- `Ctrl+b / Ctrl+f`: ページ移動
- `1-5`: DIFFICULTY フィルタ
- `0`: DIFFICULTY フィルタ解除
- `a`: `MANUAL -> AUTO SCRATCH -> AUTO` 切り替え
- `s`: HIGH-SPEED 増加 (`+0.5`)
- `S`: HIGH-SPEED 減少 (`-0.5`)
- `Enter`: 開始
- `Esc` or `Ctrl+C`: 終了

### プレイ中

- `Space`: 一時停止 / 再開
- `Alt`/`Option` + 奇数レーン入力: HIGH-SPEED 減少 (`-0.5`)
- `Alt`/`Option` + 偶数レーン入力: HIGH-SPEED 増加 (`+0.5`)
- `Esc`: 演奏終了してリザルトへ
- `Ctrl+C`: 終了

### リザルト画面

- `Enter` または `Esc`: 選曲画面へ戻る

## レーンモード自動判定と入力割り当て

### 自動判定

使用チャンネルから次のモードを自動判定します。

- `5 KEY SP`
- `5 KEY DP`
- `7 KEY SP`
- `14 KEY DP`
- `9 KEY`
- `24 KEY SP`
- `48 KEY DP`

自動判定が曖昧な場合は拡張子で補完します。

- `.bms` -> `5 KEY SP/DP`
- `.bme` -> `7 KEY SP/14 KEY DP`
- `.pms` -> `9 KEY`

### 代表モードのチャンネルと入力

| Mode | Channel -> Input |
| --- | --- |
| `5 KEY SP` | `16 -> LShift`, `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c` |
| `5 KEY DP` | `16 -> LShift`, `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `21 -> b`, `22 -> h`, `23 -> n`, `24 -> j`, `25 -> m`, `26 -> RShift` |
| `7 KEY SP` | `5 KEY SP` + `18 -> f`, `19 -> v` |
| `14 KEY DP` | `7 KEY SP` + `21 -> b`, `22 -> h`, `23 -> n`, `24 -> j`, `25 -> m`, `28 -> k`, `29 -> ,`, `26 -> RShift` |
| `9 KEY` | `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `16 -> f`, `17 -> v`, `18 -> g`, `19 -> b` |

## FREE ZONE (`17` / `27`)

- 9KEY 以外では FREE ZONE として扱います。
- 独立レーンは作らず、スクラッチレーン (`16` / `26`) に重ねて描画します。
- ノート長は 4 分音符固定です。
- 判定対象外のため、`TOTAL` / `EX-SCORE` / `SCORE` には含めません。
- 9KEY 判定時は `17` を通常レーンノートとして扱います。

## キーボード入力 (kitty keyboard protocol)

- プレイ開始時に kitty keyboard protocol へ自動オプトインします。
- 対応端末では左 Shift / 右 Shift の押下・離上を個別に処理します。
- 非対応端末では従来入力へフォールバックします。
- フォールバック時でもスクラッチ入力は `a` (1P) / `]` (2P) で代替できます。

## BGA 実装

- `04` (base) と `07` (layer) を合成して描画します。
- layer の黒 (`#000000`) は透過色として扱います。
- `#BANNER` / bmson `banner_image` は選曲画面の曲紹介 block に表示します。
- `--kitty-graphics` 指定時のみ、kitty graphics protocol 対応端末で gameplay BGA、`#STAGEFILE` loading 画面、選曲画面 banner を画像として表示します。未指定時は ANSI 描画です。
- BGA はウィンドウリサイズ時に再計算して表示サイズを更新します。
- 動画 BGA は `@uwx/libav.js-fat` でデコードします。
  - 対応コーデック: `mpeg1video`, `h264`
  - 音声トラックはデコードしません。

## スコアと判定

- 判定種別: `PERFECT`, `GREAT`, `GOOD`, `BAD`, `POOR`
- `FAST` / `SLOW` は `GREAT` / `GOOD` の早押し・遅押し時のみ加算
- 対応する未判定ノートが存在しない空打鍵は、判定も groove gauge 変動も発生しません
- EX-SCORE:
  - `PERFECT = +2`
  - `GREAT = +1`
- SCORE (200000 満点):
  - 判定基礎点 150000 + コンボ加点 50000
  - `BAD` / `POOR` は加点なし、コンボを切断

## 設定の永続化

`player` は次を保存し、次回起動時に復元します。

- Play Mode (`manual` / `auto-scratch` / `auto`)
- HIGH-SPEED
- ディレクトリごとの選曲フォーカス (`chart` / `random`)

保存先:

- `~/.be-music/player.json`

## SEA (Single Executable Applications)

```bash
# player の SEA バイナリを生成
pnpm run player:sea

# audio-renderer の SEA バイナリを生成
pnpm run audio-renderer:sea

# 生成物
./packages/player/dist-sea/be-music-player chart.bms
./packages/audio-renderer/dist-sea/be-music-audio-render chart.bms output.wav

# Node 実行ファイルを明示する場合
pnpm run player:sea --node-binary /path/to/node
pnpm run audio-renderer:sea --node-binary /path/to/node
```

補足:

- Node.js 24+ が必要です。
- Node.js 25+ では `--build-sea` を使用します。
- Node.js 24 系では `--experimental-sea-config + postject` へ自動フォールバックします。

## Exports ベンチマーク

```bash
# 全パッケージ
pnpm run bench

# 単一パッケージ（例: parser）
pnpm --filter @be-music/parser run bench
```

- 出力: `tmp/bench/exports*.json`
