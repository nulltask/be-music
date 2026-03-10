# Player 実装仕様

この文書は、`@be-music/player` の実行時仕様を定義します。
譜面フォーマットの受理規則や IR の意味は [`bms-spec.md`](./bms-spec.md)、[`bmson-spec.md`](./bmson-spec.md)、[`json-spec.md`](./json-spec.md) を優先し、この文書では player がそれらをどのように再生・判定・表示するかだけを扱います。

## 目的

- `@be-music/player` のモード別挙動を 1 か所に集約する。
- 判定、スコア、ゲージ、音声、表示の基準を明文化する。
- 実装変更時に確認すべき互換方針を残す。

## 対象範囲

この文書が対象にするのは、`autoPlay()` と `manualPlay()` が返す結果、およびそれらが内部で使う判定・表示・音声処理です。
CLI 引数、設定ファイル永続化、Node ワーカー間通信などの呼び出し方法は対象外です。

現時点で実装しているゲージは Lunatic Rave 2 互換の `NORMAL` groove gauge のみです。
`HARD` / `EX-HARD` / `HAZARD` / 段位ゲージは未実装です。

## BMS 対応範囲

この節では、[`bms-spec.md`](./bms-spec.md) の一次参照に現れる BMS コマンドとチャンネルを、現在の `player` 実装に対して分類します。
ここでの「対応」は、player が実行時にその値を参照して、再生、判定、表示、選曲画面、プレビュー、loading screen のいずれかに反映することを意味します。
parser が IR へ保持するだけで、player が実行時に参照しないものは未対応として扱います。

### 対応チャンネル

| channel | player における扱い |
| --- | --- |
| `#xxx01` | BGM / sample trigger として再生します。 |
| `#xxx02` | 小節長として時間解決と beat 解決に反映します。 |
| `#xxx03`, `#xxx08` | BPM change として時間解決に反映します。 |
| `#xxx04`, `#xxx07`, `#xxx0A` | BGA base / layer / layer2 として描画します。 |
| `#xxx06` | POOR BGA cue として扱います。`#POORBGA` 未指定時は `#BMP00` を fallback に使います。 |
| `#xxx09` | STOP として時間解決に反映します。 |
| `#xxx11-19`, `#xxx21-29` | 可視演奏ノートとして扱います。`16` / `26` は scratch、`17` / `27` は 9KEY 以外では FREE ZONE、9KEY では通常ノートです。 |
| `#xxx31-39`, `#xxx41-49` | 不可視ノートとして扱います。手動入力の候補と表示補助には使いますが、`summary.total` には含めません。`AUTO` では発音しません。 |
| `#xxx51-59`, `#xxx61-69` | BMS legacy long note として扱います。 |
| `#xxx97`, `#xxx98` | 以後に鳴る BGM / playable sound の初期 gain を変更する動的音量変更として扱います。 |
| `#xxxA0` | `#EXRANKxx` を参照する動的判定幅変更として扱います。 |
| `#xxxSC` | `#SCROLLxx` 参照の scroll segment として描画距離へ反映します。 |
| `#xxxSP` | `#SPEEDxx` 参照の speed keyframe として描画距離へ反映します。 |
| `#xxxD1-D9`, `#xxxE1-E9` | 地雷として扱います。 |

### 対応コマンド

| command | player における扱い |
| --- | --- |
| `#TITLE`, `#ARTIST`, `#GENRE` | 選曲画面、TUI、結果画面の表示に使います。 |
| `#STAGEFILE` | 選曲後の loading screen 専用画像として使います。gameplay 中の BGA renderer では参照しません。 |
| `#PLAYLEVEL`, `#DIFFICULTY` | 選曲画面の表示、ソート、フィルタ、結果表示に使います。 |
| `#BPM`, `#BPMxx`, `#STOPxx`, `#STP` | 時間解決に使います。 |
| `#RANK`, `#DEFEXRANK`, `#EXRANKxx`, `#TOTAL` | 判定幅、表示ランク、groove gauge 計算に使います。 |
| `#WAVxx`, `#BMPxx` | 音声・BGA リソース解決に使います。 |
| `#PREVIEW` | 選曲画面のプレビュー再生で優先的に使います。 |
| `#PATH_WAV` | 選曲画面プレビューのファイル探索にだけ使います。通常プレイ中の sample 解決には使いません。 |
| `#LNTYPE`, `#LNMODE`, `#LNOBJ` | BMS long note の解釈に使います。 |
| `#PLAYER` | レーンモード推定と表示上の player metadata に使います。 |
| `#VOLWAV` | 譜面全体の音量倍率として使います。 |
| `#POORBGA` | POOR 画像の既定値上書きに使います。 |
| `#SCROLLxx`, `#SPEEDxx` | ノート描画距離の計算に使います。 |
| `#RANDOM`, `#SETRANDOM`, `#IF`, `#ELSEIF`, `#ELSE`, `#ENDIF`, `#ENDRANDOM`, `#SWITCH`, `#SETSWITCH`, `#CASE`, `#SKIP`, `#DEF`, `#ENDSW` | 再生開始前に制御構文として解決します。 |

### 未対応チャンネル

| channel | 現在の player 実装 |
| --- | --- |
| `#xxxA6` | `#CHANGEOPTIONxx` の実行時反映チャンネルとしては未対応です。event として保持されても player runtime は参照しません。 |
| `#xxx1A-1Z`, `#xxx2A-2Z` など、上の対応一覧に含まれない演奏系拡張チャンネル | 現在の runtime では playable note channel として扱いません。`24 KEY SP` / `48 KEY DP` の表示モード推定と入力割り当てはありますが、これらのチャンネル自体は score/judge 対象ノートになりません。 |
| 上の対応一覧に含まれないその他の object channel | parser が保持しても、player runtime は意味解釈しません。 |

### 未対応コマンド

| command | 現在の player 実装 |
| --- | --- |
| `#SUBTITLE`, `#COMMENT`, `#TEXTxx`, `#TEXT00` | parser は保持しますが、player の表示や runtime 演出には使いません。 |
| `#OPTION`, `#CHANGEOPTIONxx`, `#WAVCMD` | parser は保持しますが、play option の強制変更や `WAVCMD` 実行は未対応です。 |
| `#BACKBMP`, `#BANNER`, `#SUBARTIST`, `#MAKER` | player runtime 専用の表示・挙動は未実装です。 |
| `#EXWAVxx`, `#EXBMPxx`, `#BGAxx`, `#SWBGAxx`, `#ARGBxx` | parser は保持しますが、player runtime は参照しません。 |
| `#BASEBPM` | parser は保持しますが、player は時間解決に使いません。 |
| `#VIDEOFILE` | parser は保持しますが、player の BGA 動画解決には使いません。現実装の動画再生は `#BMPxx` で参照した動画ファイルだけを扱います。 |
| `#MIDIFILE`, `#MATERIALS`, `#DIVIDEPROP`, `#CHARSET` | parser は保持しますが、player runtime は参照しません。 |
| `#SONGxx`, `#EXBPMxx`, `#CHARFILE`, `#ExtChr`, `#CDDA`, `#VIDEOFPS`, `#VIDEODLY`, `#VIDEOCOLORS`, `#SEEK`, `#MATERIALSBMP`, `#MATERIALSWAV` | 現在の player 実装では未対応です。 |

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

### 不可視ノート

不可視ノートは通常の演奏対象とは別に保持します。
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

## 判定幅

### 基準幅

player はまず IIDX 系の基準判定幅を持ちます。
以後の rank 解決や拡張命令は、この基準値を倍率で拡縮する形で適用します。

- `PGREAT`: `16.67ms`
- `GREAT`: `33.33ms`
- `GOOD`: `116.67ms`
- `BAD`: `250ms`

`PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR` の境界は、この 4 本の幅から決まります。
`POOR` は `BAD` 幅を超えた入力、またはノートの取り逃しで発生します。

### BMS の初期判定幅

BMS では、再生開始時点の判定幅を次の優先順位で決めます。

1. `#DEFEXRANK`
2. `metadata.rank` (`#RANK`)
3. 既定値 `#RANK 2`

`#DEFEXRANK` はパーセンテージ値として扱います。
`100` は基準値であり、`NORMAL` と同じ幅です。
player は `#DEFEXRANK` を `Number.parseFloat()` で解釈し、有限かつ `0` より大きい値だけを採用します。

`#RANK` は beatoraja 互換の倍率テーブル `[25, 50, 75, 100, 125]` として扱います。
`metadata.rank` は整数へ切り捨てて解釈し、範囲外の値は無効として既定値へフォールバックします。

- `#RANK 0`: `25%` (`VERY HARD`)
- `#RANK 1`: `50%` (`HARD`)
- `#RANK 2`: `75%` (`NORMAL`)
- `#RANK 3`: `100%` (`EASY`)
- `#RANK 4`: `125%` (`VERY EASY`)

### BMS の換算式

BMS の実際の判定幅は、`NORMAL = 75%` を基準にして計算します。
たとえば `#DEFEXRANK 120` は「基準判定幅の `1.2` 倍」であり、`PGREAT=20.004ms`, `GREAT=39.996ms`, `GOOD=140.004ms`, `BAD=300ms` として扱います。

`#RANK` から解決した値も同じ式で扱います。
たとえば `#RANK 4` は `125 / 75` 倍なので、`VERY EASY` は `NORMAL` より約 `1.666...` 倍広い判定幅です。

### BMS の動的判定幅変更

BMS では `#xxxA0` チャンネルと `#EXRANKxx` を使って、演奏途中で判定幅を変更できます。
player は `A0` チャンネルのイベント値を `#EXRANKxx` のキーとして解決し、その値を `Number.parseFloat()` で読んで、有限かつ `0` より大きい場合だけ採用します。

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

bmson の基準値は `100%` です。
そのため `judgeRank=100` は IIDX 系の基準判定幅そのままで、`50` は半分、`150` は `1.5` 倍として扱います。

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
- groove gauge を `-4` する。

### `POOR`

`POOR` は演奏対象ノートに対する失敗です。
ノートが `BAD` 窓を過ぎた場合、または手動入力のズレが `BAD` 窓を超えた場合に発生します。

`POOR` 発生時は次を行います。

- `summary.poor` を加算する。
- combo を 0 に戻す。
- groove gauge を `-6` する。
- POOR BGA を発火する。
- judge/combo 表示を `POOR` に更新する。

### `EMPTY_POOR`

`EMPTY_POOR` は、入力はあったが `BAD` 窓内に演奏対象ノートが存在しなかった場合の内部イベントです。
これは通常の判定数に含めません。

`EMPTY_POOR` 発生時は次を行います。

- groove gauge のみ `-2` する。
- `summary.poor` を増やさない。
- combo を切らない。
- POOR BGA を発火しない。
- judge/combo 表示を更新しない。

keysound fallback が存在する場合は、fallback 音を先に再生できます。
ただし FREE ZONE の fallback 発音だけは `EMPTY_POOR` を発生させず、そのまま return します。

### 地雷

手動入力時に地雷候補が通常ノート候補より近いか同距離なら、地雷を優先します。
地雷は `BAD` として扱い、combo を切り、groove gauge を `-4` します。

## NOTES・combo・score

### `summary.total`

`summary.total` は演奏対象ノート数です。
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

表示用 `score` は `0-200000` の整数です。
内部では次の 2 系統を合算してから `200000` へ正規化します。

- 判定基本点: 最大 `150000`
- combo bonus: 最大 `50000`

判定基本点の倍率は次のとおりです。

- `PERFECT`: `1.5`
- `GREAT`: `1.0`
- `GOOD`: `0.2`
- `BAD` / `POOR`: `0`

combo bonus は 1 ノートごとに最大 10 段階まで加算します。
全ノート `PERFECT` で必ず `200000` になるよう、ノート数ごとに bonus 単価を計算します。

## Groove Gauge

### 基本方針

- `NORMAL` groove gauge は Lunatic Rave 2 の既定値に合わせます。
- ゲージ表示範囲は `0-100%` ではなく、内部値 `2-100%` を使います。
- クリア判定は楽曲終了時のゲージ `80%以上` です。

### 初期値と既定値

- 初期ゲージは `20%`
- 曲中の下限は `2%`
- 上限は `100%`
- クリアラインは `80%`
- `#TOTAL` 未指定時の既定値は `160`
- `#TOTAL` 指定時はその値をそのまま使います

### 増減量

`noteCount` は TOTAL / EX-SCORE / SCORE の対象になる演奏ノート数です。
FREE ZONE、地雷、不可視オブジェクトは `noteCount` に含めません。

`baseGain = effectiveTotal / noteCount`

- `PGREAT`: `+baseGain`
- `GREAT`: `+baseGain`
- `GOOD`: `+baseGain / 2`
- `BAD`: `-4`
- `POOR`: `-6`
- `EMPTY_POOR`: `-2`

ゲージ更新後の値は `2-100%` に clamp します。

## ロングノート

### NOTES の数え方

player はロングノートを 1 本につき 1 ノートとして扱います。
`#LNOBJ` の終端オブジェクト自体は演奏ノート数に含めません。
`#mmm51-69` 由来のロングノートも、始点 1 件の演奏ノートとして数えます。

### `#LNMODE`

BMS の `#LNMODE` 未指定時は `1` として扱います。
bmson と FREE ZONE は `#LNMODE` の対象外で、終端を持つノートとして扱います。

### Manual Play

手動演奏では、ロングノートの始点入力時に始点側の判定を計算します。
ただし最終的な判定確定タイミングは `#LNMODE` に依存します。

- `LNMODE=1`: 終点まで押し続けた場合のみ、終点到達時に始点側の判定を 1 回だけ確定します。途中で離した場合はその時点で `BAD` とし、レーン音も停止します。
- `LNMODE=2`: 終点到達時、または途中離し時に終点側の判定を計算し、始点側と終点側のうち悪い方を最終判定として 1 回だけ確定します。途中離し時はレーン音も停止します。
- `LNMODE=3`: 基本の最終判定は `LNMODE=2` と同じです。加えて、保持が切れている間は groove gauge を継続的に減少させます。保持が切れたまま終点へ到達した場合、終点側は `POOR` として扱います。途中離し時はレーン音も停止します。

### Auto Play

自動演奏は現時点で `#LNMODE` を分岐しません。
ロングノートは始点で keysound 再生とレーン保持表示を開始し、`PGREAT` / combo / score / gauge の確定は終点で 1 回だけ行います。

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
候補がない場合は keysound fallback を鳴らせますが、その入力自体は `EMPTY_POOR` になることがあります。

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

この倍率は、リアルタイム再生の keysound、曲選択プレビュー、`renderJson()` を使うオフライン音声レンダリングに適用します。
現実装は線形 gain のみを適用し、歴史的な実装差やハードウェア依存の音量差までは再現しません。

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

`#STAGEFILE` の表示サイズは現在の端末サイズいっぱいまで使います。
描画時は画像の縦横比を維持したまま、terminal 全体を覆うように `cover` 相当で拡大します。端末比率と合わない場合は中央基準で一部を crop します。
loading 文言はその上へオーバーレイし、各文字セルの背景色には対応する `STAGEFILE` ピクセル色を使います。文字色は背景とのコントラスト比が高いほうを選ぶため、白または黒のどちらかになります。

`#STAGEFILE` が未指定、ファイル未発見、非対応形式、デコード失敗の場合は、画像なしのテキスト loading screen へフォールバックします。
`#STAGEFILE` は loading 専用であり、gameplay 中の BGA renderer は参照しません。最初の base BGA cue がまだ有効でない間は、viewport は黒背景のままです。

### TUI

標準 TUI は次の情報を表示します。

- 曲名、ジャンル、プレイモード、BPM、SCROLL、STOP
- progress、現在小節、判定窓、HIGH-SPEED
- NOTES / EX-SCORE / SCORE / judge counts / FAST / SLOW
- レーン本体、judge/combo、入力キー、groove gauge
- 必要に応じて RANDOM 要約、BGA、audio debug 行

ノート描画では、head と tail を long note body より優先して描画します。
地雷はさらに高優先度で描画します。

### 可視化ルール

judge 済みノートでも、judge line を跨ぐまで、または `visibleUntilBeat` が切れるまでは描画を残します。
long note は body と tail を持つ 1 本のノートとして描画し、保持中は lane highlight も継続します。
ノートの視覚距離は、`#SCROLLxx` / `#xxxSC` の piecewise-constant 係数と、`#SPEEDxx` / `#xxxSP` の piecewise-linear 補間係数を掛け合わせて積分した値で決めます。`#SPEEDxx` がない場合は常に `1`、同一 beat の複数 keyframe は後勝ちです。`#SPEEDxx` の値が負数、非数、未定義参照の場合、その keyframe は描画計算から無視します。

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
- `exScore`
- `score`
- `gauge`

`gauge` には `current` / `max` / `clearThreshold` / `initial` / `effectiveTotal` / `cleared` を含みます。

## 既知の未対応

- LR2 の `NORMAL` 以外のゲージ種別
- ゲージ種別切り替えオプション
- ゲージ推移の履歴表示
- `AUTO` での `#LNMODE` 分岐
- 空 POOR を判定数として数える互換モード
