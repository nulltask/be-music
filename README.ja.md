[English version](./README.md)

# be-music

TypeScript + pnpm workspaces で構成した BMS/BMSON ツールチェーンです。

## パッケージ

- `@be-music/json`: Be-Music 内部処理専用の BMS/BMSON 中間表現 (JSON互換) の pure IR
- `@be-music/chart`: beat 解決、イベント順序、ロングノート解決などの譜面意味論 helper
- `@be-music/utils`: 全パッケージで再利用する汎用ユーティリティ。browser-safe な core helper と Node 向け helper は狭い subpath export で分けています
- `@be-music/parser`: `.bms` / `.bme` / `.bml` / `.pms` / `.bmson` / JSON のパーサ
- `@be-music/stringifier`: JSON から `.bms` / `.bmson` への文字列化
- `@be-music/audio-renderer`: 譜面をレンダリングして `.wav` / `.aiff` を出力
- `@be-music/player`: 再生 engine、timing、判定、score、gauge、BGA timeline、UI/audio adapter 契約を共有する core package
- `@be-music/player-tui`: autoplay、keyboard play、Music Select、BGA、SEA build を扱う terminal UI と `bms-player` CLI frontend
- `@be-music/lr2-skin`: Lunatic Rave 2 skin parser、asset resolver、theme loader を renderer 非依存で提供する package
- `@be-music/beatoraja-skin`: beatoraja JSON/Lua skin parser、normalizer、theme loader を renderer 非依存で提供する package
- `@be-music/player-web`: 選曲、built-in default / LR2 / beatoraja skin 描画、gameplay、result scene、録画を扱う browser PixiJS player core
- `@be-music/player-web-demo`: folder / ZIP drop、LR2 / beatoraja theme、debug control、browser 再生を接続する private Vite demo
- `@be-music/editor`: CLI エディタ (インポート・編集・エクスポート)

## 必要環境

- Node.js `>= 26`
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

## package ごとの release

このリポジトリでは `Changesets` で package ごとの version と changelog を管理します。

```bash
pnpm run changeset
pnpm run release:status
pnpm run release:version
```

- 通常の feature PR では、変更した package に対する `.changeset/*.md` を追加します
- release したいタイミングで `devel` 上で `pnpm run release:version` を実行し、生成された `packages/*/package.json` と `packages/*/CHANGELOG.md` の更新をまとめてコミットします
- その状態で `devel -> main` の release PR を merge すると、version が上がった package だけ GitHub Release が個別に作成されます
- player SEA 実行ファイルは `@be-music/player-tui` から build し、`@be-music/player` release に添付します。`@be-music/audio-renderer` も SEA zip を添付します
- private な repository root の `package.json` は `0.0.0` のままで、release 対象 version は `packages/*/package.json` で管理します

tag は `@be-music/package-name@x.y.z` 形式で作成されます。

## 仕様書

- [仕様書トップ](docs/README.ja.md)
- [BMS 実装仕様](docs/bms-spec.ja.md)
- [BMSON 実装仕様](docs/bmson-spec.ja.md)
- [Bemuse 実装仕様](docs/bemuse-spec.ja.md)
- [Player 実装仕様](docs/player-spec.ja.md)
- [Terminal player 実装メモ](docs/player-tui.ja.md)
- [Browser player 実装メモ](docs/player-web.ja.md)
- [プレイログ（プレイ履歴）仕様](docs/playlog.ja.md)
- [LR2 skin 実装メモ](docs/lr2-skin.ja.md)
- [beatoraja skin 実装メモ](docs/beatoraja-skin.ja.md)
- [BMS/BMSON 中間表現 (`@be-music/json`) 実装仕様](docs/json-spec.ja.md)
- [用語集](docs/glossary.ja.md)

`@be-music/json` は Be-Music の内部データモデルです。配布フォーマットや他ツールとの再利用可能な交換フォーマットとしては設計していません。
譜面の意味論 helper は `@be-music/chart` に分離しており、`@be-music/json` 自体は pure IR と round-trip preservation を担当します。

## 対応状況サマリ

### parser (`@be-music/parser`)

- BMS のヘッダ / オブジェクト行 / 制御構文を保持
- `#WAVxx` / `#BMPxx` / `#BPMxx` / `#STOPxx` / `#TEXTxx` を解釈
- BMS 拡張ヘッダ (`#PREVIEW`, `#LNTYPE`, `#LNMODE`, `#LNOBJ`, `#VOLWAV`, `#SCROLLxx`, `#VIDEOFILE` など) を保持
- BMSON の `info` / `lines` / `sound_channels` / `bpm_events` / `stop_events` / `bga` を解釈
- BMS テキストの文字コード推測 (`Shift_JIS`, `UTF-8`, `EUC-JP`, `latin1` など)
- BMSON の `info.init_bpm` は parser が必須扱いにし、欠落・不正値は `130` fallback ではなく早期 error にします
- BMSON の `key_channels` mine note を `mode_hint` lane resolver 経由で map し、mine ごとの `damage` を保持

### stringifier (`@be-music/stringifier`)

- 中間表現(JSON) から BMS/BMSON を出力
- `position: [numerator, denominator]` を使って小節解像度を安定再現
- BMSON 拡張情報 (`info` 拡張, `bga`, `notes.l/c`) を出力
- `preservation` layer が normalized event と一致している場合、BMS source 構造を優先して再出力

### audio-renderer (`@be-music/audio-renderer`)

- BMS / BMSON / JSON 入力に対応
- 出力形式 `.wav` / `.aiff`
- サンプル読込: `WAV` / `MP3` / `OGG` (Vorbis/Opus) / `OPUS`
- 小節長 / BPM / STOP を反映
- LR2 系の 100001 倍 BPM ギミック値を時刻解決で処理
- `#VOLWAV`、`#xxx97` / `#xxx98`、BMSON `notes.c`、`#WAVCMD 01 xx vv`、`#EXWAVxx v` の volume scaling を反映

### player core (`@be-music/player`)

- terminal と browser runtime が共有する `autoPlay()` / `manualPlay()` engine
- lane flash、POOR BGA command、frame snapshot、pause、restart、high-speed change を流す UI / input signal bus
- playable note、legacy long note、`#LNOBJ`、FREE ZONE、mine、invisible note の共通抽出
- 判定幅、動的 `#EXRANKxx`、score、groove gauge、scroll distance、BGA timeline、result summary の共通意味論
- `core/engine`、`core/bga-timeline`、`core/scroll-distance`、`core/groove-gauge`、`playable-notes` などの browser-safe subpath export

### terminal player (`@be-music/player-tui`)

- MANUAL / AUTO SCRATCH / AUTO の 3 モード
- TUI プレイ画面と選曲画面
- 選曲画面の metadata / preview / banner 表示
- 楽曲一覧 metadata のローカル cache (`~/.be-music/chart-selection-cache.json`)
- HIGH-SPEED (`0.5` 〜 `10.0`, `0.5` 刻み)
- TUI refresh rate 設定 (`--tui-fps`, default `60`)
- 判定: `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR`（`FAST` / `SLOW` 集計あり）
- 20 万点満点 SCORE と IIDX 準拠 EX-SCORE
- 不可視ノート表示 (`--show-invisible-notes`)
- FREE ZONE (`17` / `27`) の専用扱い
- BGA 画像描画 (`BMP` / `PNG` / `JPEG`) と動画描画 (`mpeg1video` / `h264` / `mjpeg`)
- 動画 BGA の progressive decode (`--no-video-bga-streaming` で旧方式へ切り替え)
- `--kitty-graphics` / `--no-kitty-graphics` による Kitty graphics protocol 描画切り替え (default: on)
- `node-web-audio-api` 固定バックエンドで再生
- `#LNTYPE` 未指定時の自動推測 (`--ln-type-auto` / `--no-ln-type-auto`)
- 再生前 audio render (`--render-audio`) と bus ごとの音量調整 (`--volume`, `--bgm-volume`, `--key-volume`)
- compressor / limiter の有効化切り替えと threshold / release 系の出力ダイナミクス調整
- 構造化ログ出力 (`~/.be-music/logs/player.ndjson`, `--log-file` で上書き)
- gameplay、TUI 描画、video BGA decode を分離する Node worker 構成

### LR2 skin (`@be-music/lr2-skin`)

- LR2 の select / decide / play / result skin CSV を PixiJS 非依存で parse
- `#INCLUDE`、`#CUSTOMOPTION`、`#CUSTOMFILE`、`#LR2FONT`、system font、skin timer、op condition、play-skin variant を解決
- image、number、text、slider、bargraph、button、BGA、judge line、measure line、gauge、score chart、result graph element を parse
- case-insensitive / wildcard asset lookup、TGA decode、DXA archive extraction で theme asset を読み込み

### beatoraja skin (`@be-music/beatoraja-skin`)

- beatoraja JSON skin と Lua `.luaskin` entry を PixiJS 非依存で parse
- beatoraja の 2-phase Lua contract を制限付き Fengari sandbox 上で評価
- play / select / decide / result / course-result entry を discovery し、play skin を `5` / `7` / `9` / `10` / `14` / `24` / `24d` ごとに group 化
- `property[]`、`filepath[]`、category group、custom offset、wildcard source path、case-insensitive asset を解決
- image、imageset、value、float-value、text、slider、note、judge、gauge、graph、BPM graph、timing graph、song-list、custom event、destination、PM character element を normalize

### browser player (`@be-music/player-web` / `@be-music/player-web-demo`)

- dropped folder、ZIP、song / LR2 / beatoraja theme 混在 drop を扱う browser song library
- 大きな audio / video file を lazy に扱い、case-insensitive に path lookup
- skinless select、gameplay、result scene 向けの built-in default skin family
- LR2 の select / decide / gameplay / result skin を parse して PixiJS で描画
- beatoraja の select / decide / gameplay / result skin を parse して PixiJS で描画
- default gameplay chrome injection を分離し、default skin 描画が LR2 renderer module に依存しない構成
- destination 補間、sprite transform、number、text、slider、bargraph を扱う共通 LR2 Pixi helper
- destination sampling、source cell selection、text、value、slider、gauge、graph、timing visualizer、note、marker、BGA、runtime op/timer wiring を扱う共通 beatoraja Pixi helper
- note、timing、scroll distance、BGA cue、score、result は terminal player と共通の再生意味論を使用
- key / BGM / master を分けた compressor control 付き WebAudio preview / gameplay bus
- BGA still / video 描画、browser-side video transcode fallback、WebM gameplay recording
- 1 つの renderer context を所有する PixiJS scene host と scene transition 時の resource dispose
- hi-speed、BGA mode/size、filter、sort、HS-FIX、lane cover、lift、auto-scratch、DP flip、random/mirror、gauge variant、skin option を扱う LR2 / beatoraja PLAY OPTION control

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

### 5. Browser player demo

```bash
pnpm run player:web
```

demo は Vite dev server を起動します。BMS/BMSON の楽曲 folder、LR2 theme folder、beatoraja theme folder、ZIP、または楽曲 folder と LR2 / beatoraja theme folder の組み合わせを browser に drop できます。

### 6. エディタ

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
- `11..19` をすべて使う 1P keyboard、または従来 IIDX 2P channel を含まない PMS-STD `22..25` も `9 KEY` として判定します。

### 代表モードのチャンネルと入力

| Mode                     | Channel -> Input                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `5 KEY SP`               | `16 -> LShift`, `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`                                                                        |
| `5 KEY DP`               | `16 -> LShift`, `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `21 -> b`, `22 -> h`, `23 -> n`, `24 -> j`, `25 -> m`, `26 -> RShift` |
| `7 KEY SP`               | `5 KEY SP` + `18 -> f`, `19 -> v`                                                                                                            |
| `14 KEY DP`              | `7 KEY SP` + `21 -> b`, `22 -> h`, `23 -> n`, `24 -> j`, `25 -> m`, `28 -> k`, `29 -> ,`, `26 -> RShift`                                     |
| `9 KEY (BME-compatible)` | `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `16 -> f`, `17 -> v`, `18 -> g`, `19 -> b`                                            |
| `9 KEY (PMS-STD)`        | `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `22 -> f`, `23 -> v`, `24 -> g`, `25 -> b`                                            |

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
- 対応端末では、既定で kitty graphics protocol を使って gameplay BGA、`#STAGEFILE` loading 画面、選曲画面 banner を画像として表示します。
- `--no-kitty-graphics` を付けると ANSI 描画へ戻せます。
- BGA はウィンドウリサイズ時に再計算して表示サイズを更新します。
- 動画 BGA は `@uwx/libav.js-fat` でデコードします。
  - 対応コーデック: `mpeg1video`, `h264`, `mjpeg`
  - 音声トラックはデコードしません。
  - 既定では最初のフレーム取得後に再生を開始し、残りフレームはバックグラウンドで段階的にデコードします。
  - `--no-video-bga-streaming` を付けると、再生前に全フレームをデコードする旧方式へ戻せます。

## スコアと判定

- 判定種別: `PERFECT`, `GREAT`, `GOOD`, `BAD`, `POOR`
- `FAST` / `SLOW` は `GREAT` / `GOOD` の早押し・遅押し時のみ加算
- 対応する未判定ノートが存在しない空打鍵は LR2-style empty POOR として扱います。judge counter、score、EX-SCORE、combo は変えませんが、empty POOR の gauge delta を適用し、POOR BGA を起動します
- EX-SCORE:
  - `PERFECT = +2`
  - `GREAT = +1`
- SCORE (200000 満点):
  - 判定基礎点 150000 + コンボ加点 50000
  - `BAD` / `POOR` は加点なし、コンボを切断

## 設定・キャッシュ・ログ

`player` は次をローカルへ保存します。

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
# player の SEA バイナリを生成
pnpm run player:sea

# audio-renderer の SEA バイナリを生成
pnpm run audio-renderer:sea

# 生成物
./packages/player-tui/dist-sea/be-music-player chart.bms
./packages/audio-renderer/dist-sea/be-music-audio-render chart.bms output.wav

# Node 実行ファイルを明示する場合
pnpm run player:sea --node-binary /path/to/node
pnpm run audio-renderer:sea --node-binary /path/to/node
```

補足:

- Node.js 26+ が必要です。
- SEA 生成は built-in の `--build-sea` を使用します。

## Exports ベンチマーク

```bash
# 全パッケージ
pnpm run bench

# 単一パッケージ（例: parser）
pnpm --filter @be-music/parser run bench

# 複数 run を集約
pnpm run bench:aggregate -- --output tmp/bench/head.json tmp/bench/head-runs/*.json

# 2 revision を比較して Markdown を生成
pnpm run bench:compare -- --head tmp/bench/head.json --base tmp/bench/base.json --output tmp/bench/benchmark.md
```

- snapshot 出力: `tmp/bench/exports*.json`
- compare 出力: 任意の Markdown と summary JSON
- GitHub Actions では、`devel` / `main` 向け PR で base/head 比較を PR comment として投稿します
- GitHub Actions では、`devel` / `main` への push でも直前 revision 比較を実行し、対象 commit へ commit comment を投稿します
- CI は比較前に base と head を同一 runner で計測し、ホスト間ノイズが delta を支配しないようにします
- CI はローカル default より長い per-case time を使い、比較シグナルは median change です。ケース単位の一覧は点検用です
