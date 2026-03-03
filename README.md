# be-music

TypeScript + npm workspaces で構成した BMS/BMSON ツールチェーンです。

## パッケージ

- `@be-music/json`: BMS/BMSON 中間表現 (JSON互換) の型と共通ユーティリティ
- `@be-music/utils`: 全パッケージで再利用する汎用ユーティリティ
- `@be-music/parser`: `.bms` / `.bme` / `.bml` / `.pms` / `.bmson` / JSON のパーサ
- `@be-music/stringifier`: JSON から `.bms` / `.bmson` への文字列化
- `@be-music/audio-renderer`: 譜面をレンダリングして `.wav` / `.aiff` を出力
- `@be-music/player`: CLI プレイヤー (オートプレイ / キーボード演奏 / TUI)
- `@be-music/editor`: CLI エディタ (インポート・編集・エクスポート)

## 必要環境

- Node.js `>= 22`
- npm workspaces

## セットアップ

```bash
npm install
```

## ビルド・検証

```bash
npm run clean
npm run build
npm run typecheck
npm run lint
npm run test
```

`npm run build` は各ワークスペースを依存順で `vite build` し、続けて型定義 (`.d.ts`) を出力します。

## 仕様書

- [仕様書トップ](./docs/README.md)
- [BMS 実装仕様](./docs/bms-spec.md)
- [BMSON 実装仕様](./docs/bmson-spec.md)
- [Bemuse 実装仕様](./docs/bemuse-spec.md)
- [BMS/BMSON 中間表現 (`@be-music/json`) 実装仕様](./docs/json-spec.md)

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
- HIGH-SPEED (`0.5` 〜 `10.0`, `0.5` 刻み)
- 判定: `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR`（`FAST` / `SLOW` 集計あり）
- 20 万点満点 SCORE と IIDX 準拠 EX-SCORE
- 不可視ノート表示 (`--show-invisible-notes`)
- FREE ZONE (`17` / `27`) の専用扱い
- BGA 画像描画 (`BMP` / `PNG` / `JPEG`) と動画描画 (`mpeg1video` / `h264`)
- `node-web-audio-api` 固定バックエンドで再生

### editor (`@be-music/editor`)

- `init`, `import`, `export`, `set-meta`, `add-note`, `delete-note`, `list-notes`

## 主要コマンド

### 1. BMS/BMSON を JSON に変換

```bash
npm run parse -- chart.bms chart.json
```

### 2. JSON を BMS/BMSON に変換

```bash
npm run stringify -- chart.json chart.bms --format bms
npm run stringify -- chart.json chart.bmson --format bmson
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

# TUI 無効
npm run player -- chart.bms --no-tui

# HIGH-SPEED 初期値
npm run player -- chart.bms --high-speed 3.5

# 不可視チャンネル (31-39/41-49) を緑ノートで表示
npm run player -- chart.bms --show-invisible-notes

# 音声オフ
npm run player -- chart.bms --no-audio

# 出力リミッタを無効化
npm run player -- chart.bms --no-limiter

# コンプレッサを有効化
npm run player -- chart.bms --compressor --compressor-threshold-db -10 --compressor-ratio 3
```

### 5. エディタ

```bash
npm run editor -- import chart.bms chart.json
npm run editor -- add-note chart.json 0 11 1 2 01
npm run editor -- export chart.json chart.bms
```

## player 操作

### 選曲画面

- `↑/↓` or `k/j`: 移動
- `←/→` or `h/l`: ページ移動
- `Ctrl+b / Ctrl+f`: ページ移動
- `a`: `MANUAL -> AUTO SCRATCH -> AUTO` 切り替え
- `s`: HIGH-SPEED 増加 (`+0.5`)
- `S`: HIGH-SPEED 減少 (`-0.5`)
- `Enter`: 開始
- `Esc` or `Ctrl+C`: 終了

### プレイ中

- `Space`: 一時停止 / 再開
- `W`: HIGH-SPEED 増加 (`+0.5`)
- `E`: HIGH-SPEED 減少 (`-0.5`)
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
| `5 KEY SP` | `16 -> LShift/a`, `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c` |
| `5 KEY DP` | `16 -> LShift/a`, `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `21 -> ,`, `22 -> l`, `23 -> .`, `24 -> ;`, `25 -> /`, `26 -> RShift/]` |
| `7 KEY SP` | `5 KEY SP` + `18 -> f`, `19 -> v` |
| `14 KEY DP` | `7 KEY SP` + `21 -> ,`, `22 -> l`, `23 -> .`, `24 -> ;`, `25 -> /`, `28 -> :`, `29 -> _`, `26 -> RShift/]` |
| `9 KEY` | `11 -> a`, `12 -> s`, `13 -> d`, `14 -> f`, `15 -> g`, `16 -> h`, `17 -> j`, `18 -> k`, `19 -> l` |

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
- BGA はウィンドウリサイズ時に再計算して表示サイズを更新します。
- 動画 BGA は `@uwx/libav.js-fat` でデコードします。
  - 対応コーデック: `mpeg1video`, `h264`
  - 音声トラックはデコードしません。

## スコアと判定

- 判定種別: `PERFECT`, `GREAT`, `GOOD`, `BAD`, `POOR`
- `FAST` / `SLOW` は `PERFECT` の早押し/遅押し時のみ加算
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

保存先:

- `~/.be-music/player.json`

## SEA (Single Executable Applications)

```bash
# player の SEA バイナリを生成
npm run player:sea

# 生成物
./packages/player/dist-sea/be-music-player chart.bms

# Node 実行ファイルを明示する場合
npm run player:sea -- --node-binary /path/to/node
```

補足:

- Node.js 24+ が必要です。
- Node.js 25+ では `--build-sea` を使用します。
- Node.js 24 系では `--experimental-sea-config + postject` へ自動フォールバックします。

## parser ベンチマーク

```bash
# ベースライン更新
npm run bench:parser:update-baseline

# 退行チェック
npm run bench:parser:check

# 単純計測
npm run bench:parser
```

- ベースライン: `tmp/parser-benchmark-baseline.json`
- 既定の退行しきい値: `+50%`
