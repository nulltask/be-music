[English version](./glossary.md)

# 用語集

この文書は、`be-music` の仕様書と実装で使う用語を定義します。
一般的な BMS/BMSON 用語にできるだけ沿いつつ、**このリポジトリでどう扱うか**を優先します。

## 用語運用ルール

- **chart** は、譜面ファイルや再生・選択・保存の単位を指す既定語です。
- **music / 曲 / 楽曲** は、タイトルとアーティストで人間が認識する作品単位です。1 つの music に複数の chart が属することがあります。
- **song** は、このリポジトリの既定語ではありません。`song.mid`、`bemuse-song.json`、`songs[]` のような外部仕様名やファイル名をそのまま参照するときに使います。
- **Music Select** は画面名です。この画面で選択・復元する単位は chart です。

## 譜面とリソース

- **BMS**: Be-Music Source 系のテキスト譜面形式です。`#TITLE`、`#WAVxx`、`#mmmcc:...` のようなヘッダ行とオブジェクト行で構成します。
- **bmson**: JSON ベースの譜面形式です。`info`、`sound_channels`、`bga`、`lines` などの構造を持ちます。
- **チャート (chart)**: 1 つの譜面ファイル、またはその再生単位です。Music Select では 1 entry が 1 chart に対応します。
- **メタデータ (metadata)**: 曲名、アーティスト、ジャンル、コメント、`#STAGEFILE`、`#BACKBMP`、`#BANNER` など、譜面本体以外の付加情報です。
- **リソース (resource)**: 譜面や skin から参照される音声、画像、動画、テキストなどの外部ファイルです。
- **keysound**: ノートや BGM の発音に使う音声リソースです。BMS では主に `#WAVxx`、bmson では `sound_channels` が対応します。
- **preview**: Music Select で再生する短い試聴音です。`#PREVIEW` や bmson の `info.preview_music` を優先して使います。
- **BGA**: gameplay 中に表示する背景画像/動画です。base、layer、layer2、POOR などの cue を持ちます。
- **POOR BGA**: `POOR` 判定時に表示する専用 BGA です。譜面側で定義されている場合だけ使います。
- **STAGEFILE**: chart 選択後の loading screen に表示する画像です。gameplay 中の BGA とは別用途です。
- **BACKBMP**: BMS `#BACKBMP` または bmson の back-image metadata から解決する LR2 skin special graphic slot です。
- **BANNER**: Music Select に表示する横長画像です。BMS では `#BANNER`、bmson では `info.banner_image` を使います。

## 再生と判定

- **チャネル (channel)**: 譜面上の source-level lane または event 識別子です。BMS の `11`、`16`、`54` のような値や、bmson の `notes.x` などが元になります。
- **レーン (lane)**: runtime が実際に入力・描画・判定を行う単位です。source-level channel を chart mode に応じて lane へ割り当てます。
- **scratch**: スクラッチ用レーンです。SP では `16`、DP では `16` と `26` が対応します。
- **FREE ZONE**: `17` / `27` を使う特殊ノートです。9KEY 以外では scratch レーンに重ねて描画し、通常の score/gauge 対象からは外します。
- **小節 (measure)**: 譜面上の区切りです。BMS の `#mmmcc` の `mmm` や、IR の `measure` が対応します。
- **beat**: 小節長を正規化した譜面上の時間単位です。`@be-music/chart` と player runtime は beat を基準に時刻や表示位置を計算します。
- **BPM**: 1 分あたりの拍数です。譜面の時間進行を決めます。
- **STOP**: 一定時間だけ譜面時間を停止するイベントです。見た目と判定時刻の両方に影響します。
- **SCROLL**: ノートの見た目の流れ方を変える係数です。判定時刻ではなく表示位置に影響します。
- **SPEED**: `SCROLL` と組み合わせて使う、補間付きの視覚距離係数です。
- **ロングノート (long note / LN)**: 始点と終点を持つノートです。保持、離し、終点到達の扱いは `LNMODE` に依存します。
- **LNOBJ**: BMS の `#LNOBJ` で宣言する long note 終端オブジェクトです。
- **LNMODE**: BMS long note の判定確定ルールです。`1`、`2`、`3` で終点判定や hold break 時の扱いが変わります。
- **地雷 (mine)**: 押すとダメージを受けるノートです。このリポジトリでは手動地雷ヒットを `BAD` 表示と譜面値ベースの gauge damage として扱います。
- **判定 (judge)**: `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR` の結果です。score、combo、gauge へ影響します。
- **FAST / SLOW**: 判定タイミングの早押し/遅押しの補助表示です。現行実装では `GREAT` と `GOOD` のみ集計します。
- **EX-SCORE**: IIDX 互換のスコアです。一般に `PERFECT=2`、`GREAT=1`、それ以外 `0` で集計します。
- **SCORE**: 20 万点満点へ正規化した通常スコアです。
- **groove gauge**: クリア判定に使うゲージです。shared core の既定は LR2 互換の `GROOVE` (`NORMAL`) で、export された helper は browser play option 向けに `HARD`、`DEATH`、`EASY` も扱います。
- **HIGH-SPEED**: ノート表示密度を変えるユーザー設定です。譜面の時刻自体は変えません。
- **MANUAL / AUTO SCRATCH / AUTO**: 再生モードです。`MANUAL` は手動、`AUTO SCRATCH` は scratch だけ自動、`AUTO` は全自動です。
- **制御構文 (control flow)**: BMS の `#RANDOM`、`#IF`、`#SWITCH` などの分岐命令です。parser は保持し、player や audio-renderer が再生/レンダリング前に評価します。

## Runtime Package

- **player core**: `@be-music/player` の共有 engine と helper surface です。timing、note extraction、judgment、scoring、gauge helper、BGA timeline、UI/audio adapter 契約を担当します。
- **terminal player**: `@be-music/player-tui` の CLI / TUI frontend です。core engine の上に Music Select、terminal gameplay、terminal BGA、loading screen、SEA build を提供します。
- **browser player**: `@be-music/player-web` の PixiJS/WebAudio runtime と `@be-music/player-web-demo` の Vite host です。browser drop、LR2 skin rendering、browser gameplay、result scene、recording を扱います。
- **LR2 skin**: `@be-music/lr2-skin` が扱う Lunatic Rave 2 CSV skin format です。この package は PixiJS に依存せず、skin file の parse と theme asset 解決を行います。

## 内部モデル

- **IR (`@be-music/json`)**: BMS/BMSON/JSON chart を共通表現として扱う内部中間表現です。外部交換フォーマットではありません。
- **pure IR**: `@be-music/json` が譜面意味論を持たず、正規化済みデータ構造と preservation data の保持に徹する設計方針です。
- **sourceFormat**: その IR がもともと `bms`、`bmson`、`json` のどれから来たかを示す属性です。
- **round-trip**: `parse -> IR -> stringify` の往復で、元の譜面構造をできるだけ再現することです。
- **preservation**: round-trip のために source-level 情報を保持する補助層です。正規化済みの `events` / `measures` とは分けて管理します。
- **sourceLines**: BMS の header、object、control-flow 行を宣言順で保持する preservation 情報です。
- **objectLines**: 制御構文の外側にある object 行だけを保持する preservation 情報です。
- **event**: 正規化後の譜面イベントです。`measure`、`channel`、`position`、`value` を持ちます。
- **position**: IR のイベント位置です。`[numerator, denominator]` で小節内相対位置を表します。
- **chart semantics (`@be-music/chart`)**: IR の上にある譜面意味論です。beat 解決、イベント順序、long note 解決、sample trigger、BGA timeline、reference BPM などを含みます。
- **bms.controlFlow**: parser が保持する BMS 制御構文配列です。parse 時には分岐を確定しません。

## 実行時と表示

- **candidate note**: 入力イベントが来たときに、そのレーン集合で判定対象として探す未判定ノートです。
- **keysound fallback**: 判定候補ノートはないが、対応レーンに補助発音がある場合に鳴らす fallback 音です。fallback 後、通常レーンでは LR2 互換の空POORを発火し、FREE ZONE と long-note repeat-suppress 窓内では発火しません。
- **empty POOR / 空POOR**: LR2 互換の空打鍵副作用です。judge 表示を `POOR` にし、POOR BGA を発火し、`EMPTY_POOR` gauge delta を適用しますが、judge counter、combo、EX-SCORE、score は変えません。
- **stateSignals / uiSignals**: engine 本体から UI adapter へ状態を渡す信号群です。judge、combo、frame、lane flash、hold state などを通知します。
- **UI runtime**: player core と TUI/PixiJS などの具体的 frontend をつなぐ runtime display adapter です。
- **gameplay worker / UI worker**: terminal frontend で重い gameplay、rendering、video BGA 処理を分離する Node worker 構成です。
- **ANSI rendering**: 画像や BGA を terminal の文字セルと色付き文字列へ落とし込んで表示する方式です。
- **Kitty graphics protocol**: 対応端末で画像を overlay として直接表示する方式です。terminal player では既定で有効で、`--no-kitty-graphics` で無効化できます。
- **render throttle**: TUI 描画を target fps に抑える仕組みです。
- **settle delay**: Music Select の focus 移動後、preview 再生を始める前に置く短い遅延です。
- **focus key**: Music Select で最後に選んでいた項目を directory ごとに復元するための識別子です。chart だけでなく `random` entry も含みます。
- **content hash**: 楽曲一覧 cache で chart 本文の同一性を判定する hash 値です。現行実装では raw bytes の SHA-256 を使います。
- **cache hash**: 保存済み cache entry 自体の破損を検知する hash 値です。
- **Sound / Visual status**: loading screen で audio 側と visual 側の進捗を別々に表示する状態です。
- **structured log**: TUI 出力とは分離して書き出す NDJSON 実行ログです。通常は `~/.be-music/logs/player.ndjson` に出力します。
- **video BGA streaming**: gameplay 開始前には動画 BGA の最初の frame だけを確保し、残りを gameplay 開始後に段階的に decode する方針です。
- **PlayerSummary**: 再生終了後の集計結果です。judge counts、FAST/SLOW、EX-SCORE、SCORE、gauge、clear state などを含みます。

## 関連文書

- [仕様書トップ](./README.ja.md)
- [BMS 実装仕様](./bms-spec.ja.md)
- [BMSON 実装仕様](./bmson-spec.ja.md)
- [Player 実装仕様](./player-spec.ja.md)
- [Browser player 実装メモ](./player-web.ja.md)
- [LR2 skin 実装メモ](./lr2-skin.ja.md)
- [BMS/BMSON 中間表現 (`@be-music/json`) 実装仕様](./json-spec.ja.md)
