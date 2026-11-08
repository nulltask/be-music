[English version](./README.md)

# @be-music/player-terminal

autoplay、keyboard play、Music Select、BGA、SEA build を扱う terminal UI と `bms-player` CLI frontend、およびリプレイ再シミュレータ `bms-replay` です。[`@be-music/player-engine`](../player-engine/README.ja.md) と [`@be-music/player-node-audio`](../player-node-audio/README.ja.md) で再生します。

[Terminal player 実装メモ](../../docs/player-tui.ja.md) と [Player 実装仕様](../../docs/player-spec.ja.md) を参照してください。

## 機能

- MANUAL / AUTO SCRATCH / AUTO の 3 モード
- TUI プレイ画面と選曲画面
- 選曲画面の metadata / preview / banner 表示
- 楽曲一覧 metadata のローカル cache (`~/.be-music/chart-selection-cache.json`)
- HIGH-SPEED (`0.5` 〜 `10.0`, `0.5` 刻み)
- TUI refresh rate 設定 (`--tui-fps`, default `60`)
- 判定: `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR`（`FAST` / `SLOW` 集計あり）
- 20 万点満点 SCORE と 名前を言ってはいけないあのゲーム 準拠 EX-SCORE（[スコアと判定](../player-engine/README.ja.md#スコアと判定)）
- 不可視ノート表示 (`--show-invisible-notes`)
- FREE ZONE (`17` / `27`) の専用扱い（[FREE ZONE](../player-engine/README.ja.md#free-zone-17--27)）
- BGA 画像描画 (`BMP` / `PNG` / `JPEG`) と動画描画 (`mpeg1video` / `h264` / `mjpeg`)
- 動画 BGA の progressive decode (`--no-video-bga-streaming` で旧方式へ切り替え)
- `--kitty-graphics` / `--no-kitty-graphics` による Kitty graphics protocol 描画切り替え (default: on)
- `node-web-audio-api` 固定バックエンドで再生
- `#LNTYPE` 未指定時の自動推測 (`--ln-type-auto` / `--no-ln-type-auto`)
- 再生前 audio render (`--render-audio`) と bus ごとの音量調整 (`--volume`, `--bgm-volume`, `--key-volume`)
- compressor / limiter の有効化切り替えと threshold / release 系の出力ダイナミクス調整
- 構造化ログ出力 (`~/.be-music/logs/player.ndjson`, `--log-file` で上書き)
- gameplay、TUI 描画、video BGA decode を分離する Node worker 構成
- 記録したリプレイから LR2 / beatoraja / 名前を言ってはいけないあのゲームの結果を再計算する `bms-replay` CLI（[リプレイ仕様](../../docs/replay.ja.md) を参照）

## 使い方

リポジトリのルートからプレイヤーを実行します。

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

# 動画 BGA の progressive decode を無効化
pnpm run player chart.bms --no-video-bga-streaming

# 不可視チャンネル (31-39/41-49) を緑ノートで表示
pnpm run player chart.bms --show-invisible-notes

# Kitty graphics protocol を使って BGA / STAGEFILE / BANNER を画像表示
pnpm run player chart.bms --kitty-graphics

# 構造化ログ出力先を上書き
pnpm run player chart.bms --log-file /tmp/be-music.ndjson

# 音声オフ
pnpm run player chart.bms --no-audio

# 出力リミッタを無効化
pnpm run player chart.bms --no-limiter

# コンプレッサを有効化
pnpm run player chart.bms --compressor --compressor-threshold-db -10 --compressor-ratio 3

# 再生前に音声を書き出しつつ、in-game audio は無効化
pnpm run player chart.bms --render-audio preview.wav --no-audio

# 高密度譜面向けに可視ノート上限を調整
pnpm run player chart.bms --tui-visible-notes-limit 4096

# #LNTYPE 未指定時の自動推測を無効化
pnpm run player chart.bms --no-ln-type-auto
```

### リプレイの再シミュレーション

```bash
pnpm run replay -- /path/to/Song.bmplay.json
pnpm run replay -- /path/to/Song.bmplay.json --ruleset=lr2,beatoraja --json
```

オプションは [リプレイ仕様](../../docs/replay.ja.md) を参照してください。

## 操作

ここではターミナル版の操作を説明します。ブラウザ版の操作はスキンの種類とキー設定に従います。[ブラウザプレイヤーの操作](../../docs/player-web.ja.md#options-ダイアログ)を参照してください。

### 選曲画面

- `↑/↓` or `k/j`: 移動
- `←/→` or `h/l`: ページ移動
- `Ctrl+b / Ctrl+f`: ページ移動
- `g` または `Home` / `G` または `End`: 先頭 / 末尾へ移動
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
- `r`: 同じ譜面をもう一度プレイ（単一譜面モード）

## レーンの入力割り当て

レーンモードは使用チャンネルから決まります（[レーンモード自動判定](../chart-model/README.ja.md#レーンモード自動判定)）。代表モードのチャンネルと入力は次のとおりです。

| Mode                     | Channel -> Input                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `5 KEY SP`               | `16 -> LShift`, `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`                                                                            |
| `5 KEY DP`               | `16 -> LShift`, `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `21 -> b`, `22 -> h`, `23 -> n`, `24 -> j`, `25 -> m`, `26 -> RShift`     |
| `7 KEY SP`               | `5 KEY SP` + `18 -> f`, `19 -> v`                                                                                                                |
| `14 KEY DP`              | `7 KEY SP` + `21 -> b`, `22 -> h`, `23 -> n`, `24 -> j`, `25 -> m`, `28 -> k`, `29 -> ,`, `26 -> RShift`                                         |
| `9 KEY (BME-compatible)` | `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `16 -> f`, `17 -> v`, `18 -> g`, `19 -> b`                                                |
| `9 KEY (PMS-STD)`        | `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `22 -> f`, `23 -> v`, `24 -> g`, `25 -> b`                                                |
| `24 KEY SP`              | `11..19` + `1A..1O` (24 鍵、scratch なし) -> `a s d f g h j k l ; q w e r u i o p z x c v b n`。ホイール `1P -> Tab`（上）、`1Q -> LShift`（下） |
| `48 KEY DP`              | `24 KEY SP` + `21..29` + `2A..2O`。2P の鍵は印字キーを使い切り、末尾はファンクションキーになります。2P ホイール `2P -> Enter`、`2Q -> RShift`    |

## キーボード入力 (kitty keyboard protocol)

- プレイ開始時に kitty keyboard protocol へ自動オプトインします。
- 対応端末では左 Shift / 右 Shift の押下・離上を個別に処理します。
- 非対応端末では従来入力へフォールバックします。
- フォールバック時でもスクラッチ入力は `a` (1P) / `]` (2P) で代替できます。

## BGA 実装

- `04` (base) と `07` (layer) を合成して描画します。
- layer の黒 (`#000000`) は透過色として扱います。
- `#BANNER` / bmson `banner_image` は選曲画面の曲紹介 block に表示します。
- 対応端末では、既定で kitty graphics protocol を使って gameplay BGA、`#STAGEFILE` loading 画面、選曲画面 banner を画像として表示します。
- `--no-kitty-graphics` を付けると ANSI 描画へ戻せます。
- BGA はウィンドウリサイズ時に再計算して表示サイズを更新します。
- 動画 BGA は `@uwx/libav.js-fat` でデコードします。
  - 対応コーデック: `mpeg1video`, `h264`, `mjpeg`
  - 音声トラックはデコードしません。
  - 既定では最初のフレーム取得後に再生を開始し、残りフレームはバックグラウンドで段階的にデコードします。
  - `--no-video-bga-streaming` を付けると、再生前に全フレームをデコードする旧方式へ戻せます。

## 設定・キャッシュ・ログ

`@be-music/player-terminal` は次をローカルへ保存します。

- Play Mode (`manual` / `auto-scratch` / `auto`)
- HIGH-SPEED
- ディレクトリごとの最後に選んだ chart file と選曲フォーカス key

保存先と用途:

- `~/.be-music/player.json`
  - Play Mode, HIGH-SPEED, directory ごとの最後に選んだ chart file と Music Select focus key
- `~/.be-music/chart-selection-cache.json`
  - 楽曲一覧 metadata cache
  - chart 本文の `contentHash` で再利用判定し、保存済み entry は `cacheHash` で検証します
- `~/.be-music/logs/player.ndjson`
  - `player` 実行時の構造化ログ
  - `--log-file <path>` を指定した場合はその path を使います

## SEA (Single Executable Applications)

```bash
# プレイヤーの SEA バイナリを生成
pnpm run player:sea

# 生成物
./packages/player-terminal/dist-sea/be-music-player chart.bms

# Node 実行ファイルを明示する場合
pnpm run player:sea --node-binary /path/to/node
```

- Node.js 26+ が必要です。
- SEA 生成は built-in の `--build-sea` を使用します。
- player SEA 実行ファイルは `@be-music/player-terminal` の release に添付します。
