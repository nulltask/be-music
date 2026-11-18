[English version](./format-compat-bmson.md)

# bmson 互換性

[比較方法と根拠のラベル](./format-compat.ja.md)

<details>
<summary>目次</summary>

- [3. bmson](#3-bmson)
  - [3.1 `version`](#31-version)
  - [3.2 `mode_hint` と `x`](#32-mode_hint-と-x)
  - [3.3 `lines` と `resolution` と `y`](#33-lines-と-resolution-と-y)
  - [3.4 ロングノート：`l`、`c`、`ln_type`、`t`、`up`](#34-ロングノートlcln_typetup)
  - [3.5 地雷と隠しノート](#35-地雷と隠しノート)
  - [3.6 `judge_rank`](#36-judge_rank)
  - [3.7 `total`](#37-total)
  - [3.8 `bpm_events` と `stop_events`](#38-bpm_events-と-stop_events)
  - [3.9 BGA と画像](#39-bga-と画像)
  - [譜面読み込み時の警告](#譜面読み込み時の警告)

</details>

## 3. bmson

各フィールドの仕様を既存実装と比べ、Be-Music が補う既定値や変換時に保持する情報を示します。

各節で、根拠にした bmson 仕様の行を示します。

### 3.1 `version`

仕様（L238-249）が定める値は `"1.0.0"` だけです。`version` がなければ 1.0 より前の旧形式で、プレイヤーは拒否するか v0.21 として読みます。`null` はエラーです。
jbms-parser はこのフィールドを読みません [V]（[Bmson.java L8][j-bmson-model]）。
Be-Music は譜面フィールドを読む前に SemVer 表記を検証し、安定版 `1.0.0` と任意のビルドメタデータに対応します。null・不正な表記・プレリリース・その他の版を拒否し、バージョン省略の v0.21 は [Bemuse](https://github.com/bemusic/bemuse/blob/4bf3e7d98a44841b323741cc403ecb7b41618ade/packages/bmson/src/legacy.ts) と同じくフィールドと時間単位を変換して読みます（[bmson 実装仕様のチェックリスト](./bmson-spec.ja.md#parser-bmson---be-musicchart-source)）。

### 3.2 `mode_hint` と `x`

| 項目                             | de jure                                                                                                                                                                                                | beatoraja                                                                                                                                         | Be-Music                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正式な hint                      | `beat-5k`、`beat-7k`、`beat-10k`、`beat-14k`、`popn-5k`、`popn-9k`（L815-838）。既定値は `beat-7k`（L298-300）。`generic-nkeys` は本文にのみある（L304）。新しい配置には新しい hint を使う（L306-308） | 正式な 6 つと `keyboard-24k` / `keyboard-24k-double` [V]（[Mode L10-17][j-mode-enum]）                                                            | 同じ 8 つ（それぞれ固定のレーン表）と `generic-Nkeys`（[bmson 実装仕様 — 変換](./bmson-spec.ja.md#bmson---bmsbmson-中間表現-be-musicchart-source-変換)）。表は仕様（L825、L827）と beatoraja（[BMSONDecoder L117-127][j-bmson-x]）に従い、`beat-5k` / `beat-10k` もスクラッチを `x` 8 に置き（2P の鍵は `x` 9〜13、2P のスクラッチは `x` 16）、`x` 6 / 7 / 14 / 15 は空ける |
| `keyboard-24k(-double)`          | 仕様にはない。BmsONE 由来の事実上の hint                                                                                                                                                               | `x` 1〜24 が鍵、25 / 26 がホイールの上 / 下。ダブルは `x` 27 から繰り返す。ホイールのレーンは鍵と同じく判定され、RANDOM / MIRROR でも動かない [V] | 同じレーン（チャンネル `11`〜`19`、`1A`〜`1O`、ホイール `1P` / `1Q`。2P は `x` 27 から）。hint だけで 24 / 48 KEY を選ぶ                                                                                                                                                                                                                                                    |
| BmsONE の `keyboard-36k/48k/60k` | 仕様にはない                                                                                                                                                                                           | 未知の hint [V]                                                                                                                                   | 未知の hint。`keyboard-48k` は 1 人用の配置なので `keyboard-24k-double` とはみなさない                                                                                                                                                                                                                                                                                      |
| 未知の hint                      | 遊べるかどうかはプレイヤーが判断する（L306-308）                                                                                                                                                       | 警告を出し、`beat-7k` として遊ぶ [V]（[BMSONDecoder L107-113][j-bmson-mode]）                                                                     | 使われている正の `x`（`key_channels` と `mine_channels` を含む）がすべて表に収まれば、beatoraja と同じく `beat-7k`。`x` 8 より先のレーンがある譜面（BmsONE のキーボード系 hint）はそれを残し、使われている `x` の値を昇順に `11`、`12`、… へ割り当てる。beatoraja ではそれらは BGM になる                                                                                   |
| `x` = 0 や `null`                | BGM ノート（L622-625）                                                                                                                                                                                 | 1〜鍵数の範囲外の `x` はすべて BGM。たとえば `beat-5k` の `x` 6 / 7 [V]（[BMSONDecoder L118-127][j-bmson-x]）                                     | `x ≤ 0`、未指定、hint の表にない `x` は beatoraja と同じく BGM（[`bmson-document.ts`][bm-bmson-document]）。整数でない `x` は切り捨てる                                                                                                                                                                                                                                     |
| ほかのプレイヤー                 | —                                                                                                                                                                                                      | —                                                                                                                                                 | Bemuse は `mode_hint` を無視し、`x` 1〜7 を鍵、8 をスクラッチとする固定の表を使う。Qwilight は `generic-*`、`popn-*`、`beat-*` とキーボード系の hint を読み、それ以外（`beat-7k` を含む）は 7 + 1 [V]                                                                                                                                                                       |

同じサウンドチャンネルで演奏ノートと同じ `y` にある BGM ノート（`x` = 0 または hint の表にない `x`）を、Be-Music は読み込み時に捨てます（[`bmson-document.ts`][bm-bmson-document]）。

Be-Music は `generic-Nkeys`（1〜70）を、N 個の通常キーを持つ明示的な `generic-N` として保持する。疎な譜面でも格納チャンネルの `16` / `17` や第 2 バンクから scratch・FREE ZONE・DP を選ばない。Browser／Terminal の描画、入力、AUTO／replay、fingerprint で配置を保持し、beatoraja テーマでは等幅のフォールバックのノート領域を使う。範囲・判定・出力／コースの方針は [ADR 0023](./adr/0023-generic-bmson-keyboards.ja.md) を参照。

### 3.3 `lines` と `resolution` と `y`

| 項目                  | de jure                                                                             | beatoraja                                                                         | Be-Music                                                                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lines` がない        | 4/4 とみなし、4 拍ごとに小節線（L440-454）                                          | 小節線なし [V]（[BMSONDecoder L456-458][j-bmson-lines]）                          | 4/4 の小節線                                                                                                                                                                                                       |
| `lines: []`           | 小節線をまったく引かない                                                            | 小節線なし [V]                                                                    | 小節線なし（`bmson.barlinesSuppressed`）                                                                                                                                                                           |
| `y: 0` のない `lines` | 0 の小節線は省略してよい                                                            | —                                                                                 | 0 の小節線を補う                                                                                                                                                                                                   |
| `lines` がある        | 各 `y` に小節線                                                                     | その小節線だけ [V]（[BMSONDecoder L177-185][j-bmson-lines-draw]）                 | その小節線だけを引き、最後の後には足さない（[`timelines.ts`][bm-timelines] `createMeasureBoundariesBeats`）。BMS も beatoraja のセクション `0..maxsec` と同じく各小節の頭に 1 本ずつで、最後の小節の後には引かない |
| `resolution`          | 既定値は 4 分音符あたり 240 パルス。0 / `null` は既定値、負の値は絶対値（L419-427） | 0 以下なら 240 [V]（[BMSONDecoder L139][j-bmson-res]）                            | `info.resolution`、ルート直下の `resolution`、240 の順。負の値は仕様どおり絶対値として読む（[`bmson.ts`][bm-bmson] `resolveBmsonResolution`）                                                                      |
| 整数でない `y`        | `y` は符号なし整数（L72、L83）                                                      | `int` のフィールド。Jackson の型変換は確認していない。負の `y` は譜面ごと無効 [V] | 最も近いパルスに丸める                                                                                                                                                                                             |

### 3.4 ロングノート：`l`、`c`、`ln_type`、`t`、`up`

仕様が定めるのは `l`（L630-631：`l > 0` は `y + l` で終わるロングノート）と `c`（L633-636：`true` はサウンドスライスを続ける。L721：同じパルスのノートで食い違えば `false` とみなす）です。
`ln_type`、ノートごとの `t`、`up` は beatoraja の拡張で、仕様のフィールドではありません。

- beatoraja：`ln_type` 1〜3 で譜面の LN / CN / HCN を決め、`t` がノートごとに上書きし、`up` は LN の終点に専用の音を与える [V]（[BMSONDecoder L114-116, L213-296][j-bmson-ln]）。
- Be-Music：`t` > `ln_type` > LN の順で決め、その要求を BMS の `#LNMODE` と同じくルールセットが解釈する（[§2.5](./format-compat-bms.ja.md#25-ロングノート)、[`resolved-notes.ts`][bm-resolved-notes]）。`up` はロングノート終点の音として読む。`c` は仕様どおりで、「同じパルスに 1 つでも `false` があれば鳴らし直す」も含む（[`sample-triggers.ts`][bm-sample-triggers] `createBmsonSamplePlaybackMap`）。
- Bemuse は `ln_type` を無視し、Qwilight は 2 と 3 を CN 風に遊ぶ [V]。

### 3.5 地雷と隠しノート

仕様に地雷はありません。beatoraja は拡張の配列を 2 つ定めています [V]（[Bmson.java][j-bmson-model]、[BMSONDecoder L317-366][j-bmson-mine]）。

- `mine_channels`：地雷。ノートごとの `damage` をゲージの % として使う。LN の中や、ほかのノートがある位置の地雷は捨てる。
- `key_channels`：隠し（不可視）ノートで、地雷ではない。

Be-Music も beatoraja と同じく読みます。`mine_channels` は `damage` を保持した地雷（`D` / `E` チャンネル、`damage` がなければ 0 %）に、`key_channels` は不可視ノート（`3x` / `4x`）になります（[`bmson-document.ts`][bm-bmson-document]、[`note-rules.ts`][bm-note-rules]）。beatoraja と異なり、LR2 が BMS のそうした地雷を残すのと同じく、LN の中や、ほかのノートがある位置の地雷も残します（[§2.6](./format-compat-bms.ja.md#26-地雷)、[`resolved-notes.ts`][bm-resolved-notes]）。Qwilight は `mine_channels` を罠として読みます [V]。

### 3.6 `judge_rank`

仕様（L331-347）は判定幅をプレイヤーに委ねています。既定値 `100` はプレイヤー自身の既定の判定幅で、百分率としての解釈は非規範とされています。例には LR2 の `#RANK 2` の判定幅が使われています。プレイヤーの解釈は 2 つに割れており、どのプレイヤーでも同じ判定幅になる値はありません。

| `judge_rank: 100` の解釈          | プレイヤー                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NORMAL（`#RANK 2`）               | [Bemuse](https://github.com/bemusic/bemuse/blob/4bf3e7d98a44841b323741cc403ecb7b41618ade/packages/bemuse-notechart/src/loader/BmsonNotechartLoader.ts#L35-L43)（表示用の判定幅）、[Qwilight](https://github.com/thenist/Qwilight/blob/6d3887f6688a1f97c1fbe2bffd28feaedc9920b6/Qwilight/Compiler/BMSONCompiler.cs#L375)、[raindrop](https://github.com/zardoru/raindrop/blob/662dd11f05994f6f36493575b04ecb64b04dcd7b/src/NoteLoaderBMSON.cpp#L200-L215)、Be-Music の `lr2` / `____` ルールセット |
| EASY（`#RANK 3`。NORMAL は `75`） | [beatoraja](https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/BMSPlayerRule.java#L57-L66)（値を judgerank そのものとして使う。一方 `#DEFEXRANK` は `100` が NORMAL になるよう換算する）、LR2oraja、Be-Music の `beatoraja` ルールセット                                                                                                                                                                                          |

境界値：

- jbms-parser は `judge_rank` 0〜4 を警告付きで BMS の `#RANK` として読み、負の値は `#RANK 2` にする [V]（[BMSONDecoder L87-96][j-bmson-rank]）。beatoraja のルールは 0 以下を 100 にする。
- Be-Music は 0 以下の値を捨てて `100` を使う。0〜4 の特別扱いはない（[`bmson.ts`][bm-bmson]、[`judge-window.ts`][bm-judge-window]）。`beatoraja` ルールセットでは、`judge_rank` のない譜面は `100` として判定し、BMS の `#RANK 2` にはしない（[`definitions.ts`][bm-ruleset]）。
- 配布されている bmson 譜面は、ほぼすべて既定値の `100` を持つ。
- BMS から bmson への変換では、Be-Music は `#DEFEXRANK` をそのまま書き、`#RANK 0`〜`4` を `33` / `67` / `100` / `133` / `167` へ変換し、逆向きの変換では `judge_rank` を `#DEFEXRANK` として書く。`lr2` ルールセットでは 2 つのコマンドの計算が違うため、`100` 以外の値はどちらの変換でも判定幅が変わる（`#DEFEXRANK 120` は ±21.6 / ±48 / ±120 ms、`judge_rank` 120 は ±19.8 / ±52 / ±112 ms）。BmsONE は `40` / `60` / `80` / `100` / `120` を書き、bms2bmson-python は何も書かない。変換ツールの比較は [bmson 実装仕様 — プレイヤーと変換ツールでの `judge_rank` の扱い](./bmson-spec.ja.md#プレイヤーと変換ツールでの-judge_rank-の扱い) にある。

### 3.7 `total`

仕様（L366-386）：既定値は `100` で、プレイヤーの既定のゲージ増加率に対する割合。0 以上でなければならず、`0` ならゲージは増えない。負の値は絶対値とみなす。

| プレイヤー | 挙動                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| beatoraja  | 既定の TOTAL の `total / 100` 倍。0 以下は 100 % [V]（[BMSONDecoder L98-103][j-bmson-total]、[BMSPlayerRule L77-80][b-rule]）                                                                                                                                                                                                                                                            |
| その他     | Qwilight は `total` から独自の HP 増加率を求め、raindrop は既定の式に掛ける。Bemuse にはゲージがない [V]                                                                                                                                                                                                                                                                                 |
| Be-Music   | パーサは絶対値をとり、`0` は残す（[`bmson.ts`][bm-bmson]）。どのルールセットも `total` を自身の既定の TOTAL に対する百分率として読み（`lr2` は LR2 の曲線、`beatoraja` は beatoraja の式。`____` のゲージは TOTAL を使わない）、0 以下は既定値なので、仕様と異なり `0` でもゲージは止まらない。これは beatoraja に合わせたもの（[`definitions.ts`][bm-ruleset] `resolveEffectiveTotal`） |

### 3.8 `bpm_events` と `stop_events`

| 項目               | de jure                                                     | beatoraja                                                                                                                                                                                                       | Be-Music                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init_bpm`         | 必須。ないのは致命的なエラー（L326-329）                    | 検証しない [V]                                                                                                                                                                                                  | ない、0、負の値はパースエラー（[`bmson-document.ts`][bm-bmson-document]）                                                                                     |
| `bpm_events`       | 同じパルスでは最後のイベントが勝つ（L490-496）              | 0 以下は警告を出して読み飛ばす [V]（[BMSONDecoder L146-176][j-bmson-events]）                                                                                                                                   | 0 以下は読み飛ばす。同じパルスでは後のイベントが勝つ                                                                                                          |
| `stop_events`      | `duration` はパルス単位。同じパルスの停止は加算（L498-503） | パルス単位。負の長さは読み飛ばす [V]                                                                                                                                                                            | パルス単位で、`#STOP` の単位へ換算する（`× 48 / resolution`）。同じパルスの停止は加算、0 以下は読み飛ばす                                                     |
| 同じパルスでの順序 | ノートと BGA、BPM、STOP の順（L505-542）                    | スクロール、BPM、停止の順 [V]                                                                                                                                                                                   | 同じパルスの STOP より BPM 変化を先に適用する。STOP と同じパルスのノートは停止の始まりで叩く                                                                  |
| `scroll_events`    | 仕様にはない                                                | beatoraja の拡張。`{ y, rate }` を `y` のタイムラインに設定する。ほかのオブジェクトのために後から作るタイムラインは 1.0 から始まる [V]（[BMSONDecoder L146-176][j-bmson-events]、[L588-606][j-bmson-timeline]） | `#SCROLL`（チャンネル `SC`、異なる速度ごとに 1 キー）として読む。BMS と同じく次のスクロールイベントまで速度を保つ（[`bmson-document.ts`][bm-bmson-document]） |
| イベント数         | 上限なし                                                    | 上限なし。イベントごとにタイムラインへ設定する [V]                                                                                                                                                              | 上限なし。BPM / STOP は異なる値ごとに IR のキーを 1 つ割り当て、1,295 を超えると base 62 のキーにする（[`bmson-keys.ts`][bm-bmson-keys]）                     |

### 3.9 BGA と画像

仕様の `bga`（L765-806）は `bga_header`、`bga_events`、`layer_events`、`poor_events` を持ちます。ヘッダの `id` が重複すれば後のものが勝ち、レイヤーで黒は透過しません。

- beatoraja：`bga_events` で BGA を設定し、`layer_events` は条件付きのイベントレイヤーになるが描かれるのは MISS レイヤーだけ。`poor_events` は MISS レイヤーになる [V]（[BMSONDecoder L369-438][j-bmson-bga]、[BGAProcessor][b-bga]）。
- Be-Music：通常の `bga_events` をベース、`layer_events` をレイヤー、`poor_events` を POOR とし、`y` で時刻を決める（[`bga.ts`][bm-bga]）。Browser・Terminal とも bmson ヘッダーのファイル名を読み込む。シーケンス定義と条件のメタデータは往復保存できる。決定的な engine は [ADR 0022](./adr/0022-bmson-bga-events.ja.md) に従って判定連動のシーケンスを Terminal の ANSI／Kitty と Browser の 4 種類のスキンへ渡す。NONSTOP はシーケンスの参照先をステージごとに変換し、FIT でアニメーションと動画の時間を伸縮する。途中開始した ALWAYS の位相を保ち、ステージ境界で状態を解除する。
- BGA、画像、音声の名前からのファイルの探し方は [§2.19](./format-compat-bms.ja.md#219-アセットファイルの探し方) に従う。
- 画像：どちらも `back_image`、`eyecatch_image`、`banner_image`、`preview_music` を読む。Be-Music はそれぞれ `#BACKBMP`、`#STAGEFILE`（未設定のとき）、`#BANNER` に相当する欄へ入れ、さらに Browser の演奏前画面用に `title_image` を保持する。画像がない場合はテキスト表示へ戻る。
- テキスト：beatoraja は `chart_name` を `[name]` としてサブタイトルに付け加え、`subartists` をカンマでつなぐ [V]。Be-Music はどちらも構造を保ったまま持つ（[bmson 実装仕様](./bmson-spec.ja.md#実装が読み込むフィールド-parser)）。

### 譜面読み込み時の警告

Be-Music は、ブラウザの選曲・決定画面とターミナルプレイヤーの標準エラー出力に、読み込みを継続できる場合の警告を表示します。対象は旧形式の bmson の変換、未対応または無効な bmson のモード指定、長さの違いで除外された bmson の重複ノート、定義されていない譜面内の参照先、適用できなかった譜面オプションです。制御構文を含む BMS の参照先は、分岐を確定してから確認します。

ツールでは `BeMusicJSON.diagnostics` からパーサーの警告を、`resolveChart(chart).diagnostics` から読み込みと解決の両方の警告を取得できます。各警告にはコード、メッセージ、フィールドのパスまたは小節・小節内の位置・チャンネルが含まれます。警告は判定、再生、フィンガープリントに影響しません。

[bm-bmson-document]: ../packages/chart-parser/src/core/bmson-document.ts
[bm-bmson]: ../packages/chart-parser/src/core/bmson.ts
[bm-bmson-keys]: ../packages/chart-parser/src/core/bmson-keys.ts
[bm-timelines]: ../packages/chart-model/src/timelines.ts
[bm-sample-triggers]: ../packages/chart-model/src/sample-triggers.ts
[bm-resolved-notes]: ../packages/chart-model/src/resolved-notes.ts
[bm-note-rules]: ../packages/chart-model/src/note-rules.ts
[bm-judge-window]: ../packages/player-engine/src/core/judge-window.ts
[bm-ruleset]: ../packages/player-engine/src/ruleset/definitions.ts
[bm-bga]: ../packages/chart-model/src/bga.ts
[j-mode-enum]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/Mode.java#L10-L17
[j-bmson-model]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/bmson/Bmson.java
[j-bmson-rank]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L87-L96
[j-bmson-total]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L98-L103
[j-bmson-mode]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L107-L113
[j-bmson-x]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L117-L127
[j-bmson-res]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L139
[j-bmson-events]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L146-L176
[j-bmson-ln]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L213-L296
[j-bmson-mine]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L317-L366
[j-bmson-bga]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L369-L438
[j-bmson-lines]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L456-L458
[j-bmson-timeline]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L588-L606
[j-bmson-lines-draw]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L177-L185
[b-rule]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/BMSPlayerRule.java#L57-L88
[b-bga]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/bga/BGAProcessor.java#L135-L209
