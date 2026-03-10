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

## 実行フロー

player は次の順序で譜面を実行します。

1. BMS 制御構文を実行時に解決し、今回の再生で使う分岐済み譜面を作ります。
2. 分岐後の譜面から、演奏ノート、地雷、不可視ノート、リアルタイム音声トリガを抽出します。
3. 実際に存在するチャンネル群からレーンモード、キー割り当て、FREE ZONE のエイリアスを確定します。
4. ゲージ、スコア、UI state、入力 runtime、音声 runtime を初期化します。
5. `AUTO` / `MANUAL` / `AUTO SCRATCH` のいずれかのメインループを実行し、最後に `PlayerSummary` を返します。

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

## 判定窓

### 基本窓

player の基準判定窓は IIDX 系の固定値を使います。

- `PGREAT`: `16.67ms`
- `GREAT`: `33.33ms`
- `GOOD`: `116.67ms`
- `BAD`: `250ms`

### BMS の判定窓

BMS では `#DEFEXRANK` を最優先し、その次に `metadata.rank` を参照します。
`metadata.rank` は beatoraja 互換の倍率テーブル `[25, 50, 75, 100, 125]` を使い、未指定時は `75%` を既定値とします。

### bmson の判定窓

bmson では `bmson.info.judgeRank` を最優先し、未指定時は `metadata.rank`、それもなければ `100%` を使います。

### デバッグ用上書き

`judgeWindowMs` オプションは `BAD` 窓だけを直接上書きします。
`PGREAT` / `GREAT` / `GOOD` は rank 由来のスケーリング結果をそのまま使います。

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
