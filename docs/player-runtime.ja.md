[English version](./player-runtime.md)

# プレイヤーの実行時の挙動

[共通プレイヤー仕様](./player-spec.ja.md)

<details>
<summary>目次</summary>

- [モード別挙動](#モード別挙動)
  - [`AUTO`](#auto)
  - [`MANUAL`](#manual)
  - [`AUTO SCRATCH`](#auto-scratch)
- [時間制御と割り込み](#時間制御と割り込み)
  - [`speed`](#speed)
  - [シーク](#シーク)
  - [`highSpeed`](#highspeed)
  - [pause / restart / interrupt](#pause--restart--interrupt)
- [音声処理](#音声処理)
  - [再生タイミング](#再生タイミング)
  - [音量分離](#音量分離)
  - [`#VOLWAV`](#volwav)
  - [`#xxx97` / `#xxx98`](#xxx97--xxx98)
  - [BGM headroom 制御](#bgm-headroom-制御)
  - [長音停止](#長音停止)
- [UI と表示](#ui-と表示)
  - [UI runtime](#ui-runtime)
  - [可視化ルール](#可視化ルール)
  - [負の BPM — LR2 逆スクロール](#負の-bpm--lr2-逆スクロール)
  - [TUI 以外の出力](#tui-以外の出力)
- [`PlayerSummary`](#playersummary)

</details>

## モード別挙動

### `AUTO`

`AUTO` はすべての演奏対象ノートを自動で判定します。手動入力を待たず、判定幅も使いません。通常ノートは予定の時刻に `PERFECT` になります。LN 方式のロングノートは終点で 1 回、チャージノートは始点と終点で 1 回ずつ `PERFECT` になります。

一時停止、再開、リスタート、ハイスピード変更は操作できます。

### `MANUAL`

`MANUAL` では、入力トークンが指すレーンのうち、`BAD` の判定幅に入るノートから最適な候補を選びます。

候補がなければ、そのレーンですでに早押し側の `BAD` 判定幅に入った最新ノートのキー音を鳴らすことがあります。その後、LR2 互換の空 POOR を適用します。離鍵を取得できない入力では、同じレーンで保持したロングノートの終点までは空 POOR を適用しません。次のノートのキー音を鳴らせるのは、そのノートが判定幅に入ってからです。

入力がないまま `BAD` の判定幅を過ぎたノートは `POOR` になります。不可視ノートは見逃し判定の対象外です。

### `AUTO SCRATCH`

`AUTO SCRATCH` は `MANUAL` の派生です。
scratch playable channel 上の演奏ノートだけを自動で処理し、それ以外は通常の manual 判定を行います。

## 時間制御と割り込み

### `speed`

`speed` はゲーム内時間の進行速度です。
`AUTO` / `MANUAL` ともに、譜面上の seconds を実時間へ換算する際に使います。

`speed` は開始時のテンポです。ホストはプレイ中に入力コマンド `{ kind: 'tempo', tempo }` でこれを変えられます。
エンジンはコマンドを取り出した譜面時刻でクロックを付け替える（`createTempoClock`）ので、譜面時刻は途切れずに続き、そこから新しいテンポで進みます。
変更はリプレイ（`play.tempoChanges`）に記録し、`AudioSession.setTempo` を呼び、`onTempoChange` でホストへ知らせます。
判定と記録する入力は譜面時刻のままなので、再シミュレーションには影響しません。
リプレイは、ホストがログの変更を `replayTempoChanges` で渡すとそれに従います。
組み込みの Node 音声セッションは開始時のテンポで音声を作るので、変更には追従しません。

### シーク

ホストは入力コマンド `{ kind: 'seek', seconds }` で動いているプレイを譜面の別の秒数へ動かせます。`startAtSeconds` はプレイの最初のシークです（[ADR 0016](./adr/0016-seek-play-loop-command.ja.md)）。
エンジンは 1 回の取り出しのうち最後のシークを残し、次のティックで譜面の範囲に収めて適用します。リードイン中は譜面を始める位置を決めます。
音声セッションは鳴っている音を止め（`AudioSession.seek`）、目標より前の音量変化をもう一度適用し、その位置でまだ鳴っている音を途中から鳴らします（`AudioSession.triggerEventAt`）。
譜面時刻はその時点のテンポで再生クロックに付け替えるので、一時停止中のプレイは一時停止のままです。
判定の状態は、先頭からのプレイが目標の位置で持つものになります。スコア・ゲージ・コンボ・ノートの判定済みの印は 0 から作り直します。
UI には `seek` コマンド、目標をまたいで押さえているロングノートの再通知、次の `generation` を持つ目標の位置のフレームを送ります。譜面の後の保持はもう一度待てるようにします。
シークしたプレイはリプレイを記録しません。
AUTO プレイ、手動プレイ、リプレイのどれでもシークできます。手動プレイはシーク先で判定状態を作り直し、リプレイは記録された入力をシーク先まで流して作り直します。

### `highSpeed`

`highSpeed` は主に TUI の可視範囲とスクロール密度を変える表示用パラメータです。
判定窓そのものは変えません。
runtime は `@be-music/player-engine/signals` の `resolveHighSpeedMultiplier` で high-speed 値を正規化します。
有効範囲は `0.5` から `10.0` で、`0.5` 刻みに丸めます。

### pause / restart / interrupt

player は pause/resume、restart、high-speed 変更の入力イベントを処理できます。
pause 中は playback clock と audio session を同時に止め、resume で両方を再開します。

`escape` はその時点の `summary` を返して終了します。
`ctrl-c` と `restart` は `PlayerInterruptedError` を送出し、終了コードはそれぞれ `130` と `0` です。

## 音声処理

### 再生タイミング

リアルタイム再生は、分岐解決後の譜面の解決済みトリガ列（`ResolvedChart.sampleTriggers`。`collectSampleTriggers()` で作る）を使います。
再生時刻は負にならないように clamp します。

### 音量分離

`playVolume` は playable lane 側の音に適用します。
`bgmVolume` はそれ以外の BGM 側に適用します。

### `#VOLWAV`

BMS の `#VOLWAV` は譜面全体の音量倍率として扱います。
省略時は `100` を既定値とします。実効ゲインは、beatoraja と同じく `0 < bms.volWAV < 200` のとき `bms.volWAV / 100`、それ以外では `1` です（LR2 は `#VOLWAV` を無視します）。

- `#VOLWAV 100`: 原音量のまま
- `#VOLWAV 150`: 原音量の `1.5` 倍
- `#VOLWAV 0`、`#VOLWAV 200` 以上: 原音量のまま

この倍率は、リアルタイム再生の keysound、選曲画面プレビュー、`renderJSON()` を使うオフライン音声レンダリングに適用します。
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
UI コマンドキューはロングノートの開始・終了も伝えます。保持が始まると `long-note-start`（`mode` は `ln` / `cn` / `hcn`。有効なルールセットが実際にそのノートを処理するモードで、譜面の `#LNMODE` と異なる場合があります）、終わると `long-note-end`（`outcome` は `complete` / `dropped`）を送ります。
ヘルチャージノート（HCN。ヘルチャージのバックスピンスクラッチも含む）は、ゲージの刻みが切り替わるたびに判定コアから `hell-charge`（`channel`、始点の `beat`、`state`）も送ります。レーンが増やしている間は `gaining`、増やしていない間（早く離した、または始点を見逃した。押せば再び増やします）は `draining`、終点が過ぎると `passed` です。送るのは切り替わりだけで、リプレイは記録元のプレイと同じコマンドを送ります。シークでは保持中のロングノートの後に、判定ラインを通過中のヘルチャージノートの状態を送ります。AUTO と AUTO SCRATCH のレーンは常に増やすので送りません。
シークは、まだ並んでいるコマンドと判定の合図を捨ててから `seek`（`generation`、シークした `seconds`、`snapshot`：サマリ、コンボ、最大コンボ、目標より前のすべての判定）を送ります。
どのフレームもシークの `generation`（最初のシークまでは 0）と、その譜面時刻が成り立つ `clock`（音声セッションの出力クロックの `outputSeconds`、`tempo`、`paused`）を持ち、サマリは `combo` と `maxCombo` を持ちます。

`PlayerOptions.onRulesetResolved` は再生開始前に 1 回だけ `PlayerRulesetInfo`（`id`、`rulesetId`、`longNoteStyle`、譜面開始時点の判定窓 `windows`（µs））を渡して呼ばれます。ホストは判定窓を自前で導出し直さずに、エンジンが実際に使う値を表示できます。

条件付き bmson BGA の状態は `PlayerUIFramePayload.bmsonBGA` に、アクティブな画像ファイル名・レイヤー／POOR 面・起動時刻・元フレームの開始時刻として載せる。engine は [ADR 0022](./adr/0022-bmson-bga-events.ja.md) に従い、実際の判定からこの状態を作る。Terminal worker は `BgaANSIRenderer.getANSILines` / `getKittyImage` の任意の第 3 引数に渡し、既存の合成処理で元画像の alpha と動画時刻を保つ。Browser の Native／Canvas／LR2／beatoraja も BGA スタックで同じ状態を使い、すべての候補を事前に読み込んで、base／layer／POOR の動画ハンドルを独立させる。シーケンスの NONSTOP 配置は #826 の残作業とする。

端末固有の表示は [端末プレイヤーの仕様](./player-tui.ja.md) を参照してください。

### 可視化ルール

judge 済みノートでも、judge line を跨ぐまで、または `visibleUntilBeat` が切れるまでは描画を残します。
long note は body と tail を持つ 1 本のノートとして描画し、保持中は lane highlight も継続します。
ノートの視覚距離は、`#SCROLLxx` / `#xxxSC` の piecewise-constant 係数と、`#SPEEDxx` / `#xxxSP` の piecewise-linear 補間係数を掛け合わせて積分した値で決めます。`#SPEEDxx` がない場合は常に `1`、同一 beat の複数 keyframe は後勝ちです。最初の keyframe より前の区間は、beatoraja が時刻 0 の 1.0 から変化させるのと同じく、beat 0 の `1` から最初の keyframe の値まで線形に変化します（beat 0 の keyframe はすぐに効きます。Bemuse は最初の値で一定にします）。`#SPEEDxx` の値が負数、非数、未定義参照の場合、その keyframe は描画計算から無視します。

### 負の BPM — LR2 逆スクロール

channel 08 経由で負の `#BPMxx` を参照すると（先に整数へ切り捨てるため、`-1 < BPM < 0` は対象外）、LR2 の片道逆スクロール・ギミックが起動します（issue #134。LR2 の根拠と意図的な逸脱は [`bms-spec.ja.md`](./bms-spec.ja.md) 参照）。

- タイミングは単調のまま: resolver は |BPM| で積分するため、全ノートは前進する `seconds` を保持し、反転前の音声スケジューリングに影響はありません。
- 反転以降、エンジンは UI フレームに `displayBeat = 2 × beat(反転点) − beat(現在)` を載せます。LR2 の描画と同じく譜面位置空間での鏡映です。TUI グリッドと web シーンはこれでスクロールするため、譜面は反転後のテンポで逆走して見えます（反転後の STOP では止まり、後続の BPM 変化に追従し、譜面の先頭を越えて巻き戻る）。ステータスクロックと summary は実クロックのままです。
- 押下は鏡映クロック `t' = 2 × 反転点 − 現在時刻` で判定し続けます。反転点付近のノートは反転直後も叩け、レーンの次のノートが `t'` からルールセットの空 POOR 範囲内にある間は空 POOR が出て、反転以降の見逃し判定はありません。反転を跨ぐホールドは離すと BAD、離さなければ開いたままです。地雷は反転点で凍結しますが、反転点ちょうどの押下は PGREAT 範囲内の地雷をまだ起爆します。
- リアルタイム音声は LR2 のイベントポンプとともに凍結します。反転より後の BGM・キー音トリガは発火しませんが、反転と同じティックの BGM と BGA は発火します（LR2 の op 順）。BGA のキュー切り替えは止まり、再生中の動画は流れ続けます。NOWBPM は負の値の `|trunc(BPM)|` を保持します。
- 反転後は離脱操作を待ち、未判定の採点対象ノートが残っていればゲージを 0 にします。replay にはイベント時刻と、判定・描画を反転した更新の時刻を記録します。

### TUI 以外の出力

TUI が無効な場合は、モード開始メッセージ、レーン割り当て、判定ログ、最終 result をテキストで出力します。
`renderSummary()` は `TOTAL / GAUGE / PGREAT / GREAT / GOOD / BAD / POOR / EMPTY / FAST / SLOW / EX-SCORE / SCORE` の順で結果を整形します。
`EMPTY` は空 POOR の数です。`SCORE` 行は、マネースコアを定義している唯一のルールセットである `lr2` のときだけ出力します。

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
