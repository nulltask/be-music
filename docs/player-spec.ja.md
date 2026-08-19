[English version](./player-spec.md)

# Player 実装仕様

この文書は、共有 `@be-music/player` core engine の実行時仕様を定義します。
譜面フォーマットの受理規則や IR の意味は [`bms-spec.md`](./bms-spec.ja.md)、[`bmson-spec.md`](./bmson-spec.ja.md)、[`json-spec.md`](./json-spec.ja.md) を優先し、この文書では player がそれらをどのように再生・判定・表示するかだけを扱います。

## 目的

- `@be-music/player` のモード別挙動を 1 か所に集約する。
- 判定、スコア、ゲージ、音声、表示の基準を明文化する。
- 実装変更時に確認すべき互換方針を残す。

## 対象範囲

この文書が対象にするのは、`autoPlay()` と `manualPlay()` が返す結果、およびそれらが内部で使う判定・表示・音声処理です。
`@be-music/player-tui` の CLI 引数、設定ファイル永続化、Node ワーカー間通信などの呼び出し方法は対象外です。
terminal player と browser player は timing、note、BGA cue、score、result に同じ譜面意味論を再利用します。Terminal UI の挙動は [Terminal player 実装メモ](./player-tui.ja.md) に分けて記述し、PixiJS scene、LR2 / beatoraja skin 描画、browser file loading、WebAudio lifecycle は [Browser player 実装メモ](./player-web.ja.md) に分けて記述します。

core engine の既定は `lr2` 互換ルールセットと、その `GROOVE` gauge（LR2 の `NORMAL` gauge 相当）です。
どちらもオプションで、`PlayerOptions.judgeRuleset` がルールセットを、`PlayerOptions.gauge` がゲージを選びます。
`bms-player` では `--ruleset` / `--gauge` で指定できます。

## BMS 対応範囲

この節では、[`bms-spec.md`](./bms-spec.ja.md) の一次参照に現れる BMS コマンドとチャンネルを、現在の `player` 実装に対して分類します。
ここでの「対応」は、player が実行時にその値を参照して、再生、判定、表示、選曲画面、プレビュー、loading screen のいずれかに反映することを意味します。
parser が IR へ保持するだけで、player が実行時に参照しないものは未対応として扱います。

### 対応チャンネル

| channel                      | player における扱い                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#xxx01`                     | BGM / sample trigger として再生します。                                                                                                                                      |
| `#xxx02`                     | 小節長として時間解決と beat 解決に反映します。                                                                                                                               |
| `#xxx03`, `#xxx08`           | BPM change として時間解決に反映します。                                                                                                                                      |
| `#xxx04`, `#xxx07`, `#xxx0A` | BGA base / layer / layer2 として描画します。                                                                                                                                 |
| `#xxx06`                     | POOR BGA cue として扱います。`#POORBGA` 未指定時は `#BMP00` を fallback に使います。                                                                                         |
| `#xxx09`                     | STOP として時間解決に反映します。                                                                                                                                            |
| `#xxx11-19`, `#xxx21-29`     | 可視演奏ノートとして扱います。`16` / `26` は scratch、`17` / `27` は 9KEY 以外では FREE ZONE、9KEY では通常ノートです。                                                      |
| `#xxx31-39`, `#xxx41-49`     | 不可視ノートとして扱います。可視ノートと同じく対応レーンの manual keysound state を更新し、表示補助にも使えますが、`summary.total` には含めません。`AUTO` では発音しません。 |
| `#xxx51-59`, `#xxx61-69`     | BMS legacy long note として扱います。                                                                                                                                        |
| `#xxx97`, `#xxx98`           | 以後に鳴る BGM / playable sound の初期 gain を変更する動的音量変更として扱います。                                                                                           |
| `#xxxA0`                     | `#EXRANKxx` を参照する動的判定幅変更として扱います。                                                                                                                         |
| `#xxxSC`                     | `#SCROLLxx` 参照の scroll segment として描画距離へ反映します。                                                                                                               |
| `#xxxSP`                     | `#SPEEDxx` 参照の speed keyframe として描画距離へ反映します。                                                                                                                |
| `#xxxD1-D9`, `#xxxE1-E9`     | 地雷として扱います。                                                                                                                                                         |

### 対応コマンド

| command                                                                                                                                 | player における扱い                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `#TITLE`, `#SUBTITLE`, `#ARTIST`, `#SUBARTIST`, `#GENRE`, `#COMMENT`                                                                    | 選曲画面の metadata 表示に使います。`#TITLE` / `#ARTIST` / `#GENRE` は TUI と結果画面にも使います。                                                    |
| `#BANNER`                                                                                                                               | 選曲画面の banner 表示に使います。bmson では `info.banner_image` を同用途で使います。                                                                  |
| `#STAGEFILE`                                                                                                                            | 選曲後の loading screen 専用画像として使います。gameplay 中の BGA renderer では参照しません。                                                          |
| `#PLAYLEVEL`, `#DIFFICULTY`                                                                                                             | 選曲画面の表示、ソート、フィルタ、結果表示に使います。                                                                                                 |
| `#BPM`, `#BPMxx`, `#STOPxx`, `#STP`                                                                                                     | 時間解決に使います。                                                                                                                                   |
| `#RANK`, `#DEFEXRANK`, `#EXRANKxx`, `#TOTAL`                                                                                            | 判定幅、表示ランク、groove gauge 計算に使います。                                                                                                      |
| `#WAVxx`, `#BMPxx`                                                                                                                      | 音声・BGA リソース解決に使います。                                                                                                                     |
| `#BASE`                                                                                                                                 | BMS object ID の base を選びます。`#BASE 62` では sample、BGA、BPM/STOP 参照、long-note 終端、地雷値の解決時に小文字 ID を case-sensitive に扱います。 |
| `#PREVIEW`                                                                                                                              | 選曲画面のプレビュー再生で優先的に使います。                                                                                                           |
| `#PATH_WAV`                                                                                                                             | 選曲画面プレビューのファイル探索にだけ使います。通常プレイ中の sample 解決には使いません。                                                             |
| `#LNTYPE`, `#LNMODE`, `#LNOBJ`                                                                                                          | BMS long note の解釈に使います。                                                                                                                       |
| `#PLAYER`                                                                                                                               | レーンモード推定と表示上の player metadata に使います。                                                                                                |
| `#VOLWAV`                                                                                                                               | 譜面全体の音量倍率として使います。                                                                                                                     |
| `#POORBGA`                                                                                                                              | POOR 画像の既定値上書きに使います。                                                                                                                    |
| `#SCROLLxx`, `#SPEEDxx`                                                                                                                 | ノート描画距離の計算に使います。                                                                                                                       |
| `#RANDOM`, `#SETRANDOM`, `#IF`, `#ELSEIF`, `#ELSE`, `#ENDIF`, `#ENDRANDOM`, `#SWITCH`, `#SETSWITCH`, `#CASE`, `#SKIP`, `#DEF`, `#ENDSW` | 再生開始前に制御構文として解決します。                                                                                                                 |

### 未対応チャンネル

| channel                                                                     | 現在の player 実装                                                                                                                                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#xxxA6`                                                                    | `#CHANGEOPTIONxx` の実行時反映チャンネルとしては未対応です。event として保持されても player runtime は参照しません。                                                                            |
| `#xxx1A-1Z`, `#xxx2A-2Z` など、上の対応一覧に含まれない演奏系拡張チャンネル | 現在の runtime では playable note channel として扱いません。`24 KEY SP` / `48 KEY DP` の表示モード推定と入力割り当てはありますが、これらのチャンネル自体は score/judge 対象ノートになりません。 |
| 上の対応一覧に含まれないその他の object channel                             | parser が保持しても、player runtime は意味解釈しません。                                                                                                                                        |

### 未対応コマンド

| command                                                                                                                                     | 現在の player 実装                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `#TEXTxx`, `#TEXT00`                                                                                                                        | parser は保持しますが、player の表示や runtime 演出には使いません。                                                                                                                                                                        |
| `#OPTION`, `#CHANGEOPTIONxx`                                                                                                                | parser は保持しますが、core runtime での play option 強制変更は未対応です。                                                                                                                                                                |
| `#WAVCMD`, `#EXWAVxx`                                                                                                                       | parser は保持します。bundled Node realtime audio session は適用しませんが、audio-renderer と browser WebAudio は実装済みの volume subset (`#WAVCMD 01` と `#EXWAVxx v`) を反映します。pitch、loop、pan、frequency parameter は未対応です。 |
| `#BACKBMP`                                                                                                                                  | core/terminal runtime には専用挙動がありません。browser LR2 special graphic はこの値を利用できます。                                                                                                                                       |
| `#MAKER`                                                                                                                                    | metadata-only / unsupported です。                                                                                                                                                                                                         |
| `#EXBMPxx`, `#BGAxx`, `#SWBGAxx`, `#ARGBxx`                                                                                                 | parser は保持します。terminal/core runtime は適用しませんが、browser player は BGA sub-region、switching、tint、alpha の実装済み subset を描画します。                                                                                     |
| `#BASEBPM`                                                                                                                                  | parser は保持しますが、player は時間解決に使いません。                                                                                                                                                                                     |
| `#VIDEOFILE`                                                                                                                                | parser は保持しますが、player の BGA 動画解決には使いません。現実装の動画再生は `#BMPxx` で参照した動画ファイルだけを扱います。                                                                                                            |
| `#MIDIFILE`, `#MATERIALS`, `#DIVIDEPROP`, `#CHARSET`                                                                                        | parser は保持しますが、player runtime は参照しません。                                                                                                                                                                                     |
| `#SONGxx`, `#EXBPMxx`, `#CHARFILE`, `#ExtChr`, `#CDDA`, `#VIDEOFPS`, `#VIDEODLY`, `#VIDEOCOLORS`, `#SEEK`, `#MATERIALSBMP`, `#MATERIALSWAV` | 現在の player 実装では未対応です。                                                                                                                                                                                                         |

## 実行フロー

player は次の順序で譜面を実行します。

1. BMS 制御構文を実行時に解決し、今回の再生で使う分岐済み譜面を作ります。
2. 分岐後の譜面から、演奏ノート、地雷、不可視ノート、リアルタイム音声トリガを抽出します。
3. 実際に存在するチャンネル群からレーンモード、キー割り当て、FREE ZONE のエイリアスを確定します。
4. ゲージ、スコア、UI state、入力 runtime、音声 runtime を初期化します。
5. `AUTO` / `MANUAL` / `AUTO SCRATCH` のいずれかのメインループを実行し、最後に `PlayerSummary` を返します。

時間解決では、通常の `#STOPxx` に加えて、BMS 拡張 `#STP` も停止イベントとして扱います。
`#STP` は `xxx[.yyy] zzzz` を `measure xxx` の `yyy / 1000` 位置にある `zzzz ms` の停止として解釈し、同位置の複数定義は加算します。`.yyy` が省略された場合は `000` として扱います。書式に合わない `bms.stp` 要素は IR には保持されますが、player の時間解決では無視します。

## 制御構文の扱い

BMS の `#RANDOM` / `#SETRANDOM` / `#SWITCH` 系制御構文は、再生開始前に解決します。
`#RANDOM` は実行時に乱数を 1 回引き、その値を `resolveBmsControlFlow()` へ再注入して分岐を再現します。

player は UI 表示用に、今回の再生で選ばれた RANDOM パターンも保持します。
`#SETRANDOM` は固定値として記録し、複数の RANDOM 系がある場合は宣言順で `RANDOM #1 2/3  #2 1/2` のように整形します。

## ノートモデル

### 演奏対象ノート

player はまず IR の `events` を beat/seconds 付きの演奏ノート列へ正規化します。
演奏対象に含めるのは playable channel のみで、各ノートは少なくとも次の情報を持ちます。

- `channel`
- `beat`
- `seconds`
- `judged`
- 必要に応じて `endBeat` / `endSeconds` / `longNoteMode`

### ロングノート

player はロングノートを「始点 1 ノート + 終点情報」に正規化して扱います。
bmson の `l`、FREE ZONE (`17` / `27`)、BMS の `#LNOBJ`、BMS legacy LN (`#mmm51-69`) はすべてこの形へ畳み込みます。

`#LNOBJ` の終端オブジェクト自体は演奏ノート列に残しません。
そのため、`#LNOBJ` 由来の LN も `#mmm51-69` 由来の LN も、player では 1 本につき 1 ノートです。

### 地雷

地雷チャンネルは、対応する playable lane に写像したうえで別配列として保持します。
地雷は `summary.total` に含めませんが、手動入力時には通常ノートより優先して `BAD` を発生させることがあります。
`#WAV00` が定義されている場合、player は手動で地雷に当たったときの爆発音としてそれを使用します。

### 不可視ノート

不可視ノートは通常の演奏対象とは別に保持します。
可視ノートと同じタイミングルールで同レーンの keysound fallback state を更新します。不可視オブジェクトの early `BAD` 窓が開いた時点で、その WAV が後続の可視または不可視オブジェクトに置き換わるまで、そのレーンの現在 fallback 音になります。
`showInvisibleNotes` が有効な場合だけ UI 描画対象へ含めますが、判定数や `summary.total` には含めません。

### FREE ZONE

FREE ZONE (`17` / `27`) は 1 beat の終端を持つノートとして扱います。
通常の score/gauge 対象からは除外し、keysound fallback と描画上の補助対象として扱います。

## レーンモードと入力

レーンモードは、譜面に実在するチャンネル、`bms.player`、`chartExtension` から推定します。
現実装で自動判定できる主なモードは次のとおりです。

- `5 KEY SP`
- `5 KEY DP`
- `7 KEY SP`
- `14 KEY DP`
- `9 KEY (PMS-STD / PMS-COMPAT)`
- `24 KEY SP`
- `48 KEY DP`

既知の固定レイアウトに存在しないチャンネルは、未使用キーへ順番にフォールバック割り当てします。
FREE ZONE は、対応する scratch レーン (`17 -> 16`, `27 -> 26`) の入力トークンも共有します。

IIDX 系の既定キーボード配置は、1P を `Z S X D C F V`、2P を `B H N J M K ,` とします。
scratch は 1P が左 `Shift`、2P が右 `Shift` です。
reverse scratch は 1P が左 `Ctrl`、2P が右 `Ctrl` を使います。macOS では `Ctrl` の代わりに左/右 `Option` を使います。

left/right `Ctrl` と left/right `Option` の識別は kitty keyboard protocol で行います。
kitty 非対応端末へフォールバックした場合、reverse scratch の side-specific 入力は保証しません。

## 互換ルールセット

**このプレイヤーは独自の判定ロジックを持ちません。** すべてのプレイは 3 つの互換ルールセット
`lr2`（デフォルト）/ `beatoraja` / `iidx` のいずれかで動作します（`PlayerOptions.judgeRuleset`）。
判定幅、押下がどのノートを取るか、ロングノートの扱い、空 POOR の規則、ゲージの種類とカーブ、スコア計算式は
すべてルールセットが所有します。定数と出典は
[`packages/player/src/ruleset/definitions.ts`](../packages/player/src/ruleset/definitions.ts) にあり、
3 つの比較表は [`docs/playlog.ja.md`](./playlog.ja.md) にあります。

同じテーブルがライブエンジンとプレイログシミュレータの両方を駆動し、等価性テストが同一の記録入力列に対して
両者の判定が 1 つずつ一致することを要求します。

以降の章は既定の **`lr2` ルールセット**についての記述です。

## 判定幅

### 窓の形

判定窓はマイクロ秒の符号付き `[遅れ側の境界, 早い側の境界]` の組で、レーン種別（鍵盤 / スクラッチ）と文脈
（通常ノート / ロングノート終端）ごとに解決します。LR2 は 4 つの文脈すべてで同じテーブルを使いますが、
beatoraja はスクラッチを判定ごとに 10 ms 広げ、ロングノート終端に専用テーブルを持ちます。

### 基準幅

player は LR2 の実測判定幅を基準にします（hitkey 日記 2015-01-19 の実測値、lr2oraja の LR2 互換テーブルと一致）。

| `#RANK` | `PGREAT` | `GREAT` | `GOOD` | `BAD` |
| --- | --- | --- | --- | --- |
| `0` `VERY HARD` | `±8ms` | `±24ms` | `±40ms` | `±200ms` |
| `1` `HARD` | `±15ms` | `±30ms` | `±60ms` | `±200ms` |
| `2` `NORMAL` | `±18ms` | `±40ms` | `±100ms` | `±200ms` |
| `3` `EASY` | `±21ms` | `±60ms` | `±120ms` | `±200ms` |
| `4` `VERY EASY` | `NORMAL` と同一（LR2 は `#RANK 4` を `NORMAL` として扱う） | | | |

`BAD` 幅は rank・拡張命令に関わらず `±200ms` で固定です。スクラッチも鍵盤と同じ幅を使います。
`PERFECT` / `GREAT` / `GOOD` / `BAD` の境界は、この 4 本の幅を内側から順に走査して決まります。
どの窓にも入らない入力はノートに届きません — レーンのキー音だけが鳴り、押下は空 POOR の経路へ抜けます。
`POOR` は取り逃したノートです。

### BMS の初期判定幅

BMS では、再生開始時点の判定幅を次の優先順位で決めます。

1. `#DEFEXRANK`
2. `metadata.rank` (`#RANK`)
3. 既定値 `#RANK 2`

`#DEFEXRANK` はパーセンテージ値として扱います。
`100` は基準値であり、`NORMAL` と同じ幅です。
player は `#DEFEXRANK` を `Number.parseFloat()` で解釈し、有限かつ `0` より大きい値だけを採用します。

`#RANK` は内部の judgerank パーセント軸 `[25, 50, 75, 100, 75]`（`VERY HARD`=25 / `HARD`=50 / `NORMAL`=75 / `EASY`=100 / `VERY EASY`=`NORMAL` 扱い）へ写像します。
`metadata.rank` は整数へ切り捨てて解釈し、範囲外の値は無効として既定値へフォールバックします。

### BMS の換算式

判定幅は、上の実測テーブルを judgerank パーセント軸上のアンカー（25 / 50 / 75 / 100）として区分線形補間して求めます（lr2oraja の `JudgeWindowRule.LR2` と同じモデル）。
`#DEFEXRANK n` は `n × 75 / 100` でパーセント軸へ換算します。たとえば `#DEFEXRANK 120` は percent `90` であり、`PGREAT=19.8ms`, `GREAT=52ms`, `GOOD=112ms`, `BAD=200ms`（固定）になります。
`EASY`（percent `100`）を超える値は最終区間の傾きで外挿し、スケール対象は `PGREAT` / `GREAT` / `GOOD` のみです。どれだけ広げても各幅は固定の `BAD` 幅 `±200ms` を超えません。

### BMS の動的判定幅変更

BMS では `#xxxA0` チャンネルと `#EXRANKxx` を使って、演奏途中で判定幅を変更できます。
player は `A0` チャンネルのイベント値を `#EXRANKxx` のキーとして解決し、その値を `Number.parseFloat()` で読んで、有限かつ `0` より大きい場合だけ採用します。
採用した値は `#DEFEXRANK` と同じ「`RANK 2 = 100`」基準の百分率として解釈するため、`#EXRANKxx 100` はちょうど `NORMAL` の判定幅に戻ります。

`#EXRANKxx` が未定義、空文字列、非数、`0` 以下の場合、そのイベントは判定幅を変更しません。
複数の `A0` イベントがある場合は、時刻順に適用し、後から到達した値が以後の判定幅になります。

この動的変更は現在の実装では `manualPlay()` と `AUTO SCRATCH` の手動判定側で適用します。
通常の `AUTO` は全ノートを `PERFECT` 扱いするため、chart rank 由来の判定幅はスコア結果に影響しません。

動的判定幅の変更後は、次の処理に新しい `BAD` 幅を使います。

- 入力候補ノート探索
- `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR` の分類
- ノート取り逃し判定
- 地雷・不可視ノートの失効判定
- ロングノート終点の判定

### bmson の初期判定幅

bmson では次の優先順位で判定幅を決めます。

1. `bmson.info.judgeRank`
2. `metadata.rank`
3. 既定値 `100`

bmson の `judgeRank` は `#DEFEXRANK` と同じ「`100` = `NORMAL`」基準の百分率として扱い、同じ LR2 アンカー補間で判定幅へ換算します。
そのため `judgeRank=100` は `NORMAL`（`±18/±40/±100/±200ms`）そのままです。

現在の実装では、bmson に BMS の `#EXRANKxx` 相当の動的判定幅変更はありません。

### デバッグ用上書き

`judgeWindowMs` オプションは `BAD` 幅だけを直接上書きします。
`PGREAT` / `GREAT` / `GOOD` は rank 由来のスケーリング結果をそのまま使います。

この上書きは、初期判定幅だけでなく BMS の `#EXRANKxx` による動的変更後にも適用します。
つまり `#EXRANKxx` が変わっても、デバッグ上書きがある場合の `BAD` 幅は常にその固定値です。

### 表示上の扱い

選曲一覧、TUI、結果画面には、現在の chart から解決した rank 表示を出します。
`#DEFEXRANK` がある BMS はその数値を、通常の `#RANK 0-4` は対応ラベルを表示します。
同じく `PLAYLEVEL` は chart から解決した表示値を使い、BMS で `#PLAYLEVEL` が省略された場合は BM98 互換の既定値 `3` を出します。
`PLAYLEVEL` が `0` のとき、player は表示上 `?` を使います。文字列 `PLAYLEVEL` はそのまま表示し、小数値も丸め落とさず表示します。
`DIFFICULTY` は `1-5` の整数だけを表示対象として扱います。選曲一覧では `PLAYER -> DIFFICULTY -> PLAYLEVEL -> filename` の順で並べ、キー `1-5` で `DIFFICULTY` フィルタを切り替え、`0` で解除します。`DIFFICULTY` 未指定、または範囲外の値はフィルタ対象外で、表示上も `-` とします。

`#EXRANKxx` による動的変更が存在する BMS は、表示上の rank を `RANDOM` とします。
これは途中で判定幅が変わる譜面で、固定ラベル 1 つでは表現できないためです。

ただし、プレイ開始後に TUI の `BAD` 幅表示を動的更新する機能はまだありません。
現在の TUI/標準出力に出る `Judge window: ...` 行は、再生開始時点の幅を表示するだけです。

## 判定語と副作用

### `PERFECT` / `GREAT` / `GOOD`

これらは成功判定です。
判定確定時に次を行います。

- 対応する `summary` カウンタを加算する。
- EX-SCORE を加算する。
- combo を 1 増やす。
- score を更新する。
- groove gauge を加算する。

`FAST` / `SLOW` は `GREAT` と `GOOD` のみで記録します。
`PERFECT` は FAST/SLOW を増やしません。

### `BAD`

`BAD` は失敗判定です。
判定確定時に次を行います。

- `summary.bad` を加算する。
- combo を 0 に戻す。
- score を更新する。
- 通常ノートの `BAD` では groove gauge を `-4` する。
- 手動地雷ヒットでは判定表示を `BAD` のままにして、地雷値ベースのダメージを別途適用する。

### `POOR`

`POOR` は演奏対象ノートに対する失敗です。
ノートが `BAD` 窓を過ぎた場合、または手動入力のズレが `BAD` 窓を超えた場合に発生します。

`POOR` 発生時は次を行います。

- `summary.poor` を加算する。
- combo を 0 に戻す。
- groove gauge を `-6` する。
- POOR BGA を発火する。
- judge/combo 表示を `POOR` に更新する。

### 空打鍵（candidate なし）— LR2 互換 空POOR

入力はあったが、そのレーン集合に対して `BAD` 窓内の未判定ノートが存在しない場合、 LR2 互換の "空POOR" を発火します。

空POOR は LR2 における phantom press の扱いに合わせ、次の挙動とします。

- 発生条件は **同レーンのノートが「そのルールセットの miss 窓」の中にあること** です。LR2 の miss 窓は `{0, 1 s}`（lr2oraja の `JudgeProperty` LR2 ミス窓。rank / EXRANK に依存しない固定窓）なので、`lr2` ではノート通過後（遅い側）に空POOR は発生せず、1 秒以内に次のノートが無いレーンの空打鍵は keysound 再生のみで無害です。beatoraja の窓は早側 500 ms・遅側 150 ms です。
- 同一ノートの手前であれば連打で **何度でも** 発生します（LR2 の `MissCondition.ALWAYS`。判定済みノートの手前でも発生）。

- `summary.emptyPoor` を加算し、ノート判定カウンタ (`perfect`/`great`/`good`/`bad`/`poor`) は **更新しない**。ノートを消費していないため。POOR カウンタに両者の合計を表示するかは提示側の選択で、LR2 は合算します（OpenLR2 `ApplyJudgeNote` が空POOR 分岐でも `playerstat.poor` を加算）。
- EX-SCORE とスコアは **変化させない**。
- combo はルールセットが指示する場合のみ切る（`comboBreaksOnEmptyPoor`）。beatoraja の 5 鍵 / PMS のみ切れ、LR2 と IIDX は切れません。
- ゲージには `EMPTY_POOR` を適用する。デルタはルールセットのゲージ表（[`definitions.ts`](../packages/player/src/ruleset/definitions.ts)）にあり、`lr2` では GROOVE `-2`、HARD `-2`（TOTAL 補正対象）、EASY `-1.6`、DEATH `-10`。GROOVE / EASY ではほぼ無害だが、HARD / DEATH では実害が出る。
- **POOR BGA を発火する** (`trigger-poor-bga`)。
- **judge 表示を `POOR` で 0.6 秒フラッシュ** する (`publishJudgeCombo('POOR', combo)`)。 LR2 spec 上は op 246 (1P 空POOR) / 266 (2P 空POOR) と op 245 / 265 (見逃しPOOR) が分岐するが、本実装では NOWJUDGE index 0 / 1 を同じ `'poor'` skin slot に解決しているため、視覚上は同一の POOR 表示になる。

keysound fallback が存在する場合は、fallback 音を先に再生できます。
fallback は early `BAD` 窓がすでに開いた同レーン最新 WAV です。そのため 2 ノート間の空打鍵では、次ノートの判定窓が始まるまで前 WAV を鳴らし続けます。
次ノートの WAV は、その判定窓が開く前には使いません。
fallback 再生後、 FREE ZONE 上のチャンネルなら空POOR は発火させずそのまま return します (FREE ZONE は author が空打鍵による発音を意図したエリアなので、 phantom press 扱いしない)。
LN 解放直後の repeat-suppress 窓内も同様に空POOR を発火させません (直前 LN の意図された tail re-tap として扱う)。

### 地雷

地雷は LR2 の発動モデルに合わせます（LR2 自身の changelog。ダメージモデルは beatoraja `JudgeManager` で確認）。

- 発動条件は LR2 の2条件です。「**キーを押したまま地雷が判定線を通過**」または「**地雷が判定線の `PGREAT` 窓以内にあるときの押下**」で爆発します。キーが押されていない地雷の通過は無害で、通過後かつ `PGREAT` 圏外の押下も無害です。（losak の資料は `GOOD` 窓としていますが、一次資料である LR2 changelog は「ピカグレ範囲内」と明記しています。詳細は [`bms-spec.ja.md`](./bms-spec.ja.md) 参照。）
- 爆発はゲージ減少と `#WAV00` 爆発音のみで、**判定・コンボ・スコアには一切影響しません**。通常ノートの判定は爆発と独立に行われます（地雷が近接ノートへの入力を吸い込むことはありません）。
- ダメージは地雷オブジェクト値（大文字 base36）を **そのままパーセントとして解釈**します（LR2 / beatoraja 準拠。nanasi 系仕様の `value / 2` とは異なります）。bmson の `key_channels[].notes[].damage` が付いた地雷はその値を優先します。
- ダメージは HARD の 30% 緩和・`#TOTAL` 補正の対象外です（beatoraja の `gauge.addValue()` 直接加算と同じ）。
- `ZZ`（= 1295%）は survival 系（HARD / DEATH）では即 FAILED、GROOVE / EASY では下限 `2%` で止まります。
- kitty keyboard protocol 入力では押下/解放の実状態を使います。release イベントの無いフォールバック入力では、LN 保持と同じ短い grace 窓で「押されている」を近似します。

## NOTES・combo・score

### `summary.total`

`summary.total` はアクティブなルールセットの**判定数**（EX-SCORE の分母）であり、画面上のノート数ではありません。
チャージ系のスタイルはロングノートの始点と終点を別々に数えるため、1 本のロングノートが 2 判定になります。
次の要素は含みません。

- FREE ZONE
- 地雷
- 不可視ノート
- `#LNOBJ` の終端オブジェクト

### combo

combo は `PERFECT` / `GREAT` / `GOOD` のみで増加します。
`BAD` と `POOR` は combo を 0 に戻します。

### EX-SCORE

EX-SCORE は IIDX 互換です。

- `PERFECT`: `+2`
- `GREAT`: `+1`
- それ以外: `+0`

### SCORE

`score` はアクティブなルールセットが定義する値です。

- `lr2` は LR2 のマネースコア `floor((4 × PGREAT + 2 × GREAT + GOOD) × 50000 / notes)`（上限 `200000`）を返します。
  判定内訳だけで決まり、コンボ項はありません。
- `beatoraja` と `iidx` は EX-SCORE を返します。これが実機の表示です（IIDX は BISTROVER でマネースコアを廃止）。

### 空 POOR

空 POOR は「届く範囲にノートは無いが、ルールセットの miss 窓の中にノートがある」押下です。ゲージを削り POOR
演出を出しますが、ノートを消費しないため EX-SCORE には影響せず、`summary.poor` ではなく
`summary.emptyPoor` に計上されます。LR2 の miss 窓は早側のみ（`{0, 1 s}`）で、ノートの 1 秒前までの押下は
空 POOR になりますが、通過後の押下は決してなりません。beatoraja は早側 500 ms・遅側 150 ms です。
コンボを切るかどうかもルールセット次第で、beatoraja の 5 鍵 / PMS のみ切れ、LR2 と IIDX は切れません。

POOR カウンタに `poor` と `emptyPoor` の合計を表示するかは提示側の選択で、ルールセットが
`emptyPoorCountsInPoorDisplay` として持ちます。LR2 のカウンタは合算します（OpenLR2 `ApplyJudgeNote` が
空POOR 分岐でも `playerstat.poor` を加算し、LR2 に独立した統計は無いため）。そのため LR2 のゲームプレイシーンは
表示用コピーで合算し、POOR 行・BP・判定別レートがすべて追従します。beatoraja は独自の空POOR 表示を持ち、
IIDX は未測定のため、どちらも分けたままです。`PlayerSummary` は常に分けて報告します。

## Groove Gauge

### 基本方針

- ゲージは `PlayerOptions.gauge` で選び、LR2 の名前（`GROOVE` / `EASY` / `HARD` / `DEATH`）で指定します。
  各ルールセットが自分のラインナップへ対応付けます（`GROOVE` は beatoraja の `NORMAL`、`DEATH` は `HAZARD`。
  IIDX に HAZARD 相当は無いため `DEATH` は `EX-HARD` に丸められます）。
- カーブはルールセットが所有します: 判定ごとの増減、TOTAL スケーリング、guts 緩和、死亡ボーダー、
  クリア判定（回復系は閾値、サバイバル系は「一度も 0 にならなかったか」）。
- 選択したゲージは実際にプレイを支配します。色だけの飾りではありません — HARD は本当に削れ、
  底を打った HARD は `failedMidPlay` を報告し、以後クリアできません。
- テーブルは [`packages/player/src/ruleset/definitions.ts`](../packages/player/src/ruleset/definitions.ts) にあり、
  `RulesetGauge` を通して適用されます。最終スコアと summary の authority は共有エンジンで、
  browser scene は `summary.gauge` をミラーします。

### 初期値と既定値（`lr2`）

- `GROOVE` は `20%` 開始 / `2%` floor / `80%` クリア
- `EASY` は `20%` 開始 / `2%` floor / `80%` クリア（増減が緩やか）
- `HARD` / `EX-HARD` / `DEATH` は `100%` 開始で、`2%` を下回った時点で失敗
- 上限は `100%`
- `#TOTAL` 指定時はその値をそのまま使います
- `#TOTAL` 未指定時は LR2 のノート数式（`LR2_bmsload.cpp`）で求めます:
  400 ノート未満は `(n / 5 + 200) × 0.8`、600 未満は `((n - 400) / 2.5 + 280) × 0.8`、
  それ以上は `((n - 600) / 5 + 360) × 0.8`。beatoraja と IIDX はそれぞれ独自の既定値を使います。

### 増減量

`noteCount` は TOTAL / EX-SCORE / SCORE の対象になる演奏ノート数です。
FREE ZONE、地雷、不可視オブジェクトは `noteCount` に含めません。

次の delta は `lr2` ルールセットの `GROOVE` gauge 向けです。`HARD`、`DEATH`、`EASY` と他ルールセットの値は
[`definitions.ts`](../packages/player/src/ruleset/definitions.ts) にあります。

`baseGain = effectiveTotal / noteCount`

- `PGREAT`: `+baseGain`
- `GREAT`: `+baseGain`
- `GOOD`: `+baseGain / 2`
- `BAD`: `-4`
- `POOR`: `-6`
- 手動地雷ヒット: `-(mineValue(base36) / 2)`

ゲージ更新後の値は、現在の gauge type の min/max range に clamp します。

`HARD` / `EASY` / `DEATH` の variant は LR2 の値（beatoraja `GaugeProperty` の `HARD_LR2` / `EASY_LR2` / `HAZARD_LR2`）に合わせます。

- `HARD`: 回復 `PGREAT/GREAT +0.1` / `GOOD +0.05`（TOTAL 非依存）、減少 `BAD -6` / `見逃しPOOR -10` / `空POOR -2`。減少には `#TOTAL` 補正表（`TOTAL ≥240` で `×1.0` から `<120` で `×10` まで）を掛け、ゲージが `32%` 未満のときはさらに `×0.6` に緩和します（lr2oraja は比較前にゲージを偶数パーセントへ切り捨てるため、
  「表示 30 %」は内部 32 % に相当します）。
- `EASY`: 増加は GROOVE の `1.2` 倍、減少は `0.8` 倍（`BAD -3.2` / `POOR -4.8` / `空POOR -1.6`）。クリア閾値は GROOVE と同じ `80%` です。
- `DEATH`（LR2 HAZARD 相当）: `PGREAT +0.15` / `GREAT +0.06` / `GOOD 0`、`BAD` / `見逃しPOOR` は `-100`（即死）、`空POOR -10`。
- `HARD` / `DEATH` は `2%` 未満になった時点で `0%` に落ちて FAILED 確定（以後回復しません）。地雷ダメージなどの生デルタは guts・TOTAL 補正の対象外です。

## ロングノート

### NOTES の数え方

ロングノート 1 本が何判定に相当するかはルールセットが決めます。LR2 はすべて LN として 1 判定、
チャージ系のスタイルは始点と終点を別々に判定するため 2 判定です。

`#LNOBJ` の終端オブジェクト自体は決して数えません。
`#mmm51-69` 由来のロングノートも `#LNOBJ` 由来と同じ数え方です。

### ロングノートのスタイル

譜面の `#LNMODE` は要求であって決定ではありません。ルールセットが実際に演奏する形へ写像します。

- `lr2`（`ln`）: `#LNMODE` に関わらずすべて LN。判定は 1 回だけ遅延確定し、途中離しは `BAD`。
- `beatoraja`（`per-note`）: 譜面に従う — `1` が LN、`2` が CN、`3` が HCN。
- `iidx`（`charge`）: すべてチャージノート（譜面が `3` なら HCN）。始点が `BAD` / `POOR` だと終点判定は取り消されます。

BMS の `#LNMODE` 未指定時は `1` として扱います。
bmson は beatoraja 拡張の `info.ln_type` と note 単位の `t`（1: LN / 2: CN / 3: HCN、`t` が `ln_type` より優先）でモードを決め、どちらも未指定の場合は LR2 準拠の既定として `1`（LN）を使います。
FREE ZONE は `#LNMODE` の対象外で、終端を持つノートとして扱います。

### Manual Play

手動演奏では、ロングノートの始点入力時に始点側の判定を計算します。
以下のモードは譜面の `#LNMODE` そのものではなく、ルールセットが解決した**実効モード**です。

- モード `1`（LN）: 始点判定を保持し、終点到達時に 1 回だけ確定します。途中で離した場合はその時点で `BAD` とし、レーン音も停止します。
- モード `2`（CN）: 始点は押下時に即座に加点されます。終点は**離した瞬間**の時刻で判定し（フレーム時刻ではなく
  実際の解放時刻を使います）、2 つ目の判定として加算します。終点を過ぎても押し続けている間はまだ判定になりません —
  終点の遅れ側の窓が閉じるまで離す猶予があります。途中離し時はレーン音も停止します。
- モード `3`（HCN）: モード `2` に加え、保持が切れている間は継続的にゲージを減少させます。
  保持が切れたまま終点へ到達した場合、終点側は `POOR` になります。

一度も触れなかったロングノートは始点分の `POOR` 1 つに加え、チャージ系ではさらに終点分の `POOR` を負います。
ただし IIDX は終点判定が取り消されるため、負いません。

### Auto Play

ロングノートは始点で keysound 再生とレーン保持表示を開始し、終点で確定します。
LN 系スタイルは `PGREAT` を 1 回、チャージ系は始点・終点の 2 回です。

### AUTO SCRATCH

`AUTO SCRATCH` は manual ループ上で scratch レーン (`16` / `26`) だけを自動処理するモードです。
long note の確定タイミングは `AUTO` と同じく終点です。

## モード別挙動

### `AUTO`

`AUTO` は演奏対象ノートをすべて自動で処理します。
通常ノートは時刻到達時に `PERFECT` を 1 回確定し、long note は終点で `PERFECT` を確定します。

`AUTO` は pause/resume、restart、high-speed 変更を受け付けます。
判定窓や手動入力候補探索は使いません。

### `MANUAL`

`MANUAL` は入力トークンに対応するレーン集合から、`BAD` 窓内で最も適切な候補ノートを選びます。
候補がない場合、runtime は early `BAD` 窓がすでに開いた同レーン最新 keysound を再生でき、その後 FREE ZONE 上のチャンネルまたは long-note repeat-suppress 窓内でない限り、LR2 互換の空POORを適用します。
次ノートの keysound は、そのノートの判定窓が開く前には再生しません。

手動入力では、ノート未入力のまま `BAD` 窓を過ぎた対象を自動的に `POOR` とします。
不可視ノートはこの miss 判定の対象に含めません。

### `AUTO SCRATCH`

`AUTO SCRATCH` は `MANUAL` の派生です。
scratch playable channel 上の演奏ノートだけを自動で処理し、それ以外は通常の manual 判定を行います。

## 時間制御と割り込み

### `speed`

`speed` はゲーム内時間の進行速度です。
`AUTO` / `MANUAL` ともに、譜面上の seconds を実時間へ換算する際に使います。

### `highSpeed`

`highSpeed` は主に TUI の可視範囲とスクロール密度を変える表示用パラメータです。
判定窓そのものは変えません。
runtime は `@be-music/player/core/high-speed-control` で high-speed 値を正規化します。
有効範囲は `0.5` から `10.0` で、`0.5` 刻みに丸めます。

### pause / restart / interrupt

player は pause/resume、restart、high-speed 変更の入力イベントを処理できます。
pause 中は playback clock と audio session を同時に止め、resume で両方を再開します。

`escape` はその時点の `summary` を返して終了します。
`ctrl-c` と `restart` は `PlayerInterruptedError` を送出し、終了コードはそれぞれ `130` と `0` です。

## 音声処理

### 再生タイミング

リアルタイム再生は、分岐解決後の譜面から `collectSampleTriggers()` で生成したトリガ列を使います。
再生時刻は負にならないように clamp します。

### 音量分離

`playVolume` は playable lane 側の音に適用します。
`bgmVolume` はそれ以外の BGM 側に適用します。

### `#VOLWAV`

BMS の `#VOLWAV` は譜面全体の音量倍率として扱います。
省略時は `100` を既定値とし、実効ゲインは `bms.volWav / 100` です。

- `#VOLWAV 100`: 原音量のまま
- `#VOLWAV 200`: 原音量の `2` 倍
- `#VOLWAV 0`: 無音

この倍率は、リアルタイム再生の keysound、選曲画面プレビュー、`renderJson()` を使うオフライン音声レンダリングに適用します。
現実装は線形 gain のみを適用し、player やハードウェアに依存する音量差までは再現しません。

### `#xxx97` / `#xxx98`

BMS の `97` / `98` channel は、演奏途中の bus volume automation として扱います。
`97` は BGM 側、`98` は playable/key 側に対応し、値 `01-FF` を `value / 255` の gain へ変換します。

- `#xxx97`: BGM 側の音量を更新する
- `#xxx98`: playable/key 側の音量を更新する
- `FF`: 原音量
- `00`: 空トークンなのでイベントは生成されない

player は同時刻の sample trigger より先に `97` / `98` を適用します。
そのため、同じ beat に volume change と発音がある場合、発音時には新しい音量が使われます。

この変更は、その時点以降に新しく trigger される音の初期 gain だけに反映します。
すでに再生中の voice は変更しません。CLI の `playVolume` / `bgmVolume` や `#VOLWAV` がある場合は、それらと乗算で適用します。

この解釈を採る理由は、再生中 PCM の gain を瞬時に掛け替えると不連続な段差が入りやすく、クリックや不安定な音量変化として聞こえやすいためです。
また、`#xxx98` は playable/key sound の発音条件に近い命令として読めるので、「以後に鳴る音の初期 gain を変える」と解釈したほうが実装と結果の対応が分かりやすくなります。

### BGM headroom 制御

`limiter === false` のときは auto mix 用の BGM headroom 制御を有効にします。
このモードでは playable/key-sound 側の振幅を維持したまま、加算後のピークがクリップしない範囲まで BGM 側だけを縮小します。

### 長音停止

manual long note で保持が切れた場合は、対応チャンネルの再生音を停止します。
`LNMODE=3` では hold break 中もゲージ減少だけ継続します。

## UI と表示

### UI runtime

player 本体は UI 実装に依存せず、`stateSignals` と `uiSignals` を通じて状態を通知します。
judge/combo、フレーム情報、POOR BGA、レーンフラッシュ、レーン保持表示はこの信号経由で伝えます。

### Loading screen

選曲後の loading 中は、CLI が progress bar と現在の手順を標準出力へ描画します。
このとき `metadata.stageFile` が存在し、画像を解決できる場合は、その画像を ANSI 化して terminal 全体へ描画し、loading 文言はその上にオーバーレイします。

loading 文言は高レベルの `Step` に加えて、`Sound` と `Visual` の個別状態を表示します。
audio 読み込みと graphics 読み込みは並列に進むため、どちらで待っているかを画面上で判別できます。
各行の detail には、必要に応じて現在処理中のファイル名や `3/24` のような件数も表示します。

`#STAGEFILE` の表示サイズは現在の端末サイズいっぱいまで使います。
描画時は画像の縦横比を維持したまま、terminal 全体を覆うように `cover` 相当で拡大します。端末比率と合わない場合は中央基準で一部を crop します。
loading 文言はその上へオーバーレイし、各文字セルの背景色には対応する `STAGEFILE` ピクセル色を使います。文字色は背景とのコントラスト比が高いほうを選ぶため、白または黒のどちらかになります。

`#STAGEFILE` が未指定、ファイル未発見、非対応形式、デコード失敗の場合は、画像なしのテキスト loading screen へフォールバックします。
`#STAGEFILE` は loading 専用であり、gameplay 中の BGA renderer は参照しません。最初の base BGA cue がまだ有効でない間は、viewport は黒背景のままです。
`--kitty-graphics` が有効で、対応端末なら `#STAGEFILE` は Kitty graphics protocol の画像 overlay として表示します。未指定時は ANSI 表示です。
動画 BGA の既定実装は progressive decode です。最初のフレームが用意できた時点で UI runtime を ready にし、残りのフレームは gameplay 開始後に別 worker で段階的にデコードします。

### Music Select (選曲画面)

選曲画面は次の情報を表示します。

- 選択中チャートの `TITLE` / `SUBTITLE` / `ARTIST` / `SUBARTIST` / `GENRE` / `COMMENT`
- 譜面一覧 (`PLAYER`, `DIFF`, `RANK`, `PLEVEL`, `BPM`, `NOTES`)
- 操作ヘルプ、現在 directory、play mode、HIGH-SPEED、audio backend
- `#BANNER` または bmson `info.banner_image`

banner は metadata block の右側に表示し、縦横比を維持したまま block 内に収めます。
`--kitty-graphics` が有効で、対応端末なら banner も Kitty graphics protocol で表示します。未指定時は ANSI 表示です。

選曲画面では `#PREVIEW` を優先してプレビュー再生します。
プレビュー開始前には短い settle delay を置き、カーソル連打中に preview 処理が走り続けないようにします。
Music Select の focus は directory ごとに保存し、chart だけでなく `random` entry も復元します。
楽曲一覧の chart summary はユーザーごとの local cache を使って再利用し、chart 本文の content hash が一致する間は再 parse を省略します。

### TUI

標準 TUI は次の情報を表示します。

- 曲名、ジャンル、プレイモード、BPM、SCROLL、STOP
- progress、現在小節、判定窓、HIGH-SPEED
- NOTES / EX-SCORE / SCORE / judge counts / FAST / SLOW
- レーン本体、judge/combo、入力キー、groove gauge
- 必要に応じて RANDOM 要約、BGA、audio debug 行

TUI の描画上限はデフォルト `60fps` です。
`--tui-fps <value>` を指定すると、再生中の target refresh rate を任意の正の値へ変更できます。

ノート描画では、head と tail を long note body より優先して描画します。
地雷はさらに高優先度で描画します。
レーン外側には再生進捗 indicator を表示し、現在位置に最も近い行ほど明るい縦バーで表示します。

### 可視化ルール

judge 済みノートでも、judge line を跨ぐまで、または `visibleUntilBeat` が切れるまでは描画を残します。
long note は body と tail を持つ 1 本のノートとして描画し、保持中は lane highlight も継続します。
ノートの視覚距離は、`#SCROLLxx` / `#xxxSC` の piecewise-constant 係数と、`#SPEEDxx` / `#xxxSP` の piecewise-linear 補間係数を掛け合わせて積分した値で決めます。`#SPEEDxx` がない場合は常に `1`、同一 beat の複数 keyframe は後勝ちです。最初の keyframe より前の区間は、最初の keyframe の値で一定です（Bemuse 参照実装に準拠）。`#SPEEDxx` の値が負数、非数、未定義参照の場合、その keyframe は描画計算から無視します。

### TUI 以外の出力

TUI が無効な場合は、モード開始メッセージ、レーン割り当て、判定ログ、最終 result をテキストで出力します。
`renderSummary()` は `TOTAL / GAUGE / PGREAT / GREAT / GOOD / BAD / POOR / FAST / SLOW / EX-SCORE / SCORE` の順で結果を整形します。

## `PlayerSummary`

`PlayerSummary` は最終的な再生結果です。
主な項目は次のとおりです。

- `total`
- `perfect`
- `fast`
- `slow`
- `great`
- `good`
- `bad`
- `poor`
- `emptyPoor`
- `exScore`
- `score`
- `gauge`

`gauge` には `current` / `max` / `clearThreshold` / `initial` / `effectiveTotal` / `cleared` に加え、
`type`（ルールセット固有のゲージ ID）/ `survival` / `failedMidPlay` を含みます。

## 既知の未対応

- browser gameplay での 2P 独立 gauge variant
- ゲージ推移タイムライン表示
- beatoraja の非デフォルトのノート選択アルゴリズム（`duration` / `lowest` / `score`）は実装済みですが
  オプションとしては公開していません
