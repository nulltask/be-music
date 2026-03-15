# 用語集

この文書は、`be-music` の仕様書と実装で使う用語をまとめたものです。
ここでの定義は一般的な BMS/BMSON 用語を踏まえつつ、**このリポジトリでどう扱うか**を優先します。

## 用語運用ルール

- **chart** は、譜面ファイルや再生・選択・保存の単位を指す既定語とします。
- **music / 曲 / 楽曲** は、画面名や user-facing な説明で使う語とし、内部処理の単位を指すときは原則 `chart` と区別します。
- **song** は、このリポジトリの既定語ではなく、外部仕様名やファイル名（例: `song.mid`, `bemuse-song.json`, `songs[]`）をそのまま参照するときにだけ使います。
- **Music Select** は画面名です。この画面で実際に選択・復元する単位は chart です。

## 一般用語

### 譜面とリソース

- **BMS**: Be-Music Source 系のテキスト譜面形式です。`#TITLE` や `#WAVxx`、`#mmmcc:...` のようなヘッダ/オブジェクト行で構成します。
- **bmson**: JSON ベースの譜面形式です。`info`、`sound_channels`、`bga`、`lines` などの構造を持ちます。
- **チャート (chart)**: 1 つの譜面ファイル、またはその再生単位です。選曲画面では 1 entry が 1 chart に対応します。
- **曲 / 楽曲 (music)**: `TITLE` / `ARTIST` などで人間が認識する作品単位です。1 つの music に複数の chart が属することがあります。
- **メタデータ (metadata)**: 曲名、アーティスト、ジャンル、コメント、`#STAGEFILE`、`#BANNER` など、譜面本体以外の付加情報です。
- **リソース (resource)**: 音声、画像、動画など、譜面から参照される外部ファイルです。
- **song**: このリポジトリの内部用語というより、外部仕様やファイル名に現れる語です。特に `song.mid` や `bemuse-song.json` のような upstream 名称をそのまま指すときに使います。
- **keysound**: ノートや BGM の発音に使う音声リソースです。BMS では主に `#WAVxx`、bmson では `sound_channels` が対応します。
- **preview**: 選曲画面で再生する短い試聴音です。`#PREVIEW` や bmson の `info.preview_music` を優先して使います。
- **BGA**: gameplay 中に表示する背景画像/動画です。base、layer、poor などの cue を持ちます。
- **POOR BGA**: `POOR` 判定時に表示する専用 BGA です。譜面側で定義されている場合だけ使います。
- **STAGEFILE**: 選曲後の loading screen に表示する画像です。gameplay 中の BGA とは別用途です。
- **BANNER**: 選曲画面の曲紹介ブロックに表示する横長画像です。BMS では `#BANNER`、bmson では `info.banner_image` を使います。

### 再生と判定

- **チャネル (channel)**: BMS/BMSON 上の譜面データを識別する単位です。BMS の `11`、`16`、`54` のような値や、bmson の `notes.x` が元になる source-level の識別子を指します。
- **レーン (lane)**: player が実際に入力・描画・判定を行う単位です。source-level の channel を、演奏モードに応じて lane へ割り当てます。
- **scratch**: スクラッチ用レーンです。SP では `16`、DP では `16` と `26` が対応します。
- **FREE ZONE**: `17` / `27` を使う特殊ノートです。9KEY 以外では scratch レーンに重ねて描画し、通常の score/gauge 対象からは外します。
- **小節 (measure)**: 譜面上の区切りです。BMS の `#mmmcc` の `mmm` や、IR の `measure` が対応します。
- **beat**: 小節長を正規化した譜面上の時間単位です。player や `@be-music/chart` は beat を基準に時刻や表示位置を計算します。
- **BPM**: 1 分あたりの拍数です。譜面の時間進行を決めます。
- **STOP**: 一定時間だけ譜面時間を停止するイベントです。見た目と判定時刻の両方に影響します。
- **SCROLL**: ノートの見た目の流れ方を変える係数です。判定時刻ではなく表示位置側へ影響します。
- **SPEED**: ノートの視覚距離を補間付きで変える係数です。`SCROLL` と組み合わせて使います。
- **ロングノート (long note / LN)**: 始点と終点を持つノートです。保持、離し、終点到達の扱いは `LNMODE` に依存します。
- **LNOBJ**: BMS の `#LNOBJ` で宣言する long note 終端オブジェクトです。
- **LNMODE**: BMS long note の判定確定ルールです。`1`、`2`、`3` で終点判定や hold break 時の扱いが変わります。
- **地雷 (mine)**: 押すとダメージを受けるノートです。このリポジトリでは `BAD` 相当として扱います。
- **判定 (judge)**: `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR` の結果です。score、combo、gauge へ影響します。
- **FAST / SLOW**: 判定タイミングの早押し/遅押しの補助表示です。現行実装では `GREAT` と `GOOD` のみ集計し、`PERFECT` では増やしません。
- **EX-SCORE**: IIDX 互換のスコアです。一般に `PERFECT=2`, `GREAT=1`, それ以外 `0` で集計します。
- **SCORE**: 20 万点満点の通常スコアです。judge と note 数から計算します。
- **groove gauge**: クリア判定に使うゲージです。現状は LR2 互換の `NORMAL` のみ実装しています。
- **HIGH-SPEED**: ノートの落下表示を拡大・縮小するユーザー設定です。譜面の時刻自体は変えません。
- **MANUAL / AUTO SCRATCH / AUTO**: player の演奏モードです。`MANUAL` は手動、`AUTO SCRATCH` は scratch だけ自動、`AUTO` は全自動です。
- **Music Select**: 選曲画面の画面名です。譜面一覧、metadata、preview、banner、操作ヘルプを表示します。画面名は music ですが、選択単位は chart です。
- **制御構文 (control flow)**: BMS の `#RANDOM`、`#IF`、`#SWITCH` などの分岐命令です。parser は保持し、player や audio-renderer が実行時に評価します。

## 内部実装で使う用語

### データモデル

- **IR (`@be-music/json`)**: このリポジトリ内で BMS/BMSON を共通表現として扱うための中間表現です。外部交換フォーマットではなく、内部処理専用です。
- **pure IR**: `@be-music/json` が譜面意味論を持たず、正規化済みデータ構造と補助情報の保持に徹する、という設計方針です。
- **sourceFormat**: その IR がもともと `bms`、`bmson`、`json` のどれから来たかを示す属性です。
- **round-trip**: `parse -> IR -> stringify` の往復で、元の譜面構造をできるだけ崩さず再現することです。
- **preservation**: round-trip のために source-level 情報を保持する補助層です。正規化済みの `events` / `measures` とは分けて管理します。
- **sourceLines**: BMS の全行を宣言順で保持する preservation 情報です。header / object / 制御構文の相対位置を保った再出力に使います。
- **objectLines**: 制御構文の外側にある object 行だけを保持する preservation 情報です。
- **event**: 正規化後の譜面イベントです。`measure`、`channel`、`position`、`value` を持ちます。
- **position**: IR のイベント位置です。`[numerator, denominator]` で小節内相対位置を表します。
- **chart semantics (`@be-music/chart`)**: beat 解決、イベント順序、long note 解決、sample trigger 判定など、IR の上にある譜面意味論です。
- **bms.controlFlow**: parser が保持する BMS 制御構文の配列です。パース時には分岐を確定せず、再生/レンダリング時に評価します。

### 実行時と表示

- **candidate note**: 入力イベントが来たときに、そのレーンで「今判定対象として探しに行く未判定ノート」です。candidate が無ければ、その入力は何もしません。
- **keysound fallback**: 判定対象ノートは無いが、対応レーンに補助発音がある場合に鳴らす fallback 音です。空打鍵でも追加の判定や gauge 変動は起こしません。
- **stateSignals / uiSignals**: engine 本体から UI へ状態を渡す信号群です。judge、combo、フレーム、lane flash、hold 状態などを通知します。
- **UI runtime**: gameplay 中の表示実装をまとめた層です。player 本体と TUI/CLI 表示の橋渡しをします。
- **gameplay worker / UI worker**: Node 実装で重い処理を分離する worker です。UI 描画や BGA 処理は UI worker 側で扱います。
- **ANSI rendering**: 画像や BGA を terminal の文字セルと色付き文字列へ落とし込んで表示する方式です。
- **Kitty graphics protocol**: 対応端末で画像を overlay として直接表示する方式です。このリポジトリでは opt-in の `--kitty-graphics` で有効化します。
- **render throttle**: TUI 描画を target fps に抑える仕組みです。描画更新が来ても、最終 render は一定間隔以下に間引きます。
- **settle delay**: 選曲 preview をすぐには始めず、カーソルが少し落ち着くまで待つ短い遅延です。連続移動時の引っかかりを減らします。
- **focus key**: Music Select で最後に選んでいた項目を directory ごとに保存するための識別子です。通常 chart だけでなく `random` entry も含みます。
- **content hash**: 楽曲一覧 cache で、元の chart 本文が同一かを判定するための hash 値です。現行実装では raw bytes の `SHA-256` を使います。
- **cache hash**: 保存済み cache entry 自体の改竄や破損を検知するための hash 値です。`content hash` と persisted summary から再計算して検証します。
- **Sound / Visual status**: loading screen で別々に表示する audio 側・graphics 側の進捗状態です。並列読み込み時に、どちらで待っているかを見分けるために使います。
- **structured log**: `player` が NDJSON で出力する実行ログです。`stdout` / `stderr` の TUI 描画とは分離し、既定では `~/.be-music/logs/player.ndjson` を使います。
- **video BGA streaming**: 動画 BGA の最初のフレームだけ先に確保して再生開始を許可し、残りフレームを gameplay 開始後に段階的にデコードする実装方針です。
- **PlayerSummary**: 再生終了後に得られる集計結果です。judge counts、`FAST` / `SLOW`、`EX-SCORE`、`SCORE`、`gauge` などを含みます。

## 関連文書

- [仕様書トップ](./README.md)
- [BMS 実装仕様](./bms-spec.md)
- [BMSON 実装仕様](./bmson-spec.md)
- [Player 実装仕様](./player-spec.md)
- [BMS/BMSON 中間表現 (`@be-music/json`) 実装仕様](./json-spec.md)
