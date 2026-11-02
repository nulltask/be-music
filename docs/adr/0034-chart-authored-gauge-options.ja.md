[English](./0034-chart-authored-gauge-options.md)

# 0034: 譜面指定の GAMELEVEL と EXTRA を各 ruleset のゲージに対応させる

## 背景

nanasigroove では、譜面の初期 `#OPTION` で `774:GAMELEVEL_*`（BEGINNER・NORMAL・HYPER・DANGER：ステージのクリア条件と失敗条件）と `774:EXTRA_*`（EASY・HARD・VERYHARD：ゲージの増減の速さ）を選べます。どちらも A6 では使えません。[hitkey 氏のカタログ](https://hitkey.nekokan.dyndns.info/option.htm)は、nanasigroove 1.552 で `#TOTAL 400` として各組み合わせを測っています。

| GAMELEVEL | 開始  | クリア | 失敗   | EXTRA の効果                                                                         |
| --------- | ----- | ------ | ------ | ------------------------------------------------------------------------------------ |
| BEGINNER  | 30 %  | 70 %   | なし   | EASY は回復が増える。HARD・VERYHARD は NORMAL 相当                                   |
| NORMAL    | 25 %  | 80 %   | なし   | EASY は回復が増える。HARD は 80 % 開始で 0 % 失敗。VERYHARD は 60 % 開始でより厳しい |
| HYPER     | 50 %  | 90 %   | 0 %    | EASY は変わらない。HARD・VERYHARD は減りがずっと速い                                 |
| DANGER    | 100 % | 不問   | 5 MISS | EASY は変わらない。HARD・VERYHARD は最初の MISS で失敗                               |

カタログには、これらの値がノート数や TOTAL でどう変わるかの記載がありません。Be-Music の 3 つの判定ルールとの関係も示されていません。ゲージ、TOTAL の扱い、クリアランプは ruleset ごとに異なります。同じ項目では譜面の指定がプレイヤー自身の設定に優先する、とオーナーが決めました（#845）。

## 決定

**移植せず対応させる。** 譜面の組み合わせは共通語彙のゲージを 1 つ選び、プレイの判定ルールがそのゲージを自身の数値・TOTAL の扱い・クリア境界・ランプで動かします。nanasigroove の百分率を写すと、スケール規則も専用ランプもない 4 つ目のゲージ系統が増えます。各行は、挙動が最も近い ruleset のゲージです。

| GAMELEVEL \ EXTRA | OFF    | EASY        | HARD    | VERYHARD |
| ----------------- | ------ | ----------- | ------- | -------- |
| BEGINNER          | EASY   | ASSIST-EASY | GROOVE  | GROOVE   |
| NORMAL            | GROOVE | EASY        | HARD    | EX-HARD  |
| HYPER             | HARD   | HARD        | EX-HARD | EX-HARD  |
| DANGER            | DEATH  | DEATH       | DEATH   | DEATH    |

GAMELEVEL のない EXTRA は、nanasigroove の既定である NORMAL に適用します。ruleset にないゲージは GROOVE 側へ 1 段ずつ戻します。LR2 は ASSIST-EASY を EASY、EX-HARD を HARD とし、`____` は DEATH を EX-HARD とします（beatoraja はすべてを持ち、DEATH は HAZARD です）。GAMELEVEL と EXTRA はそれぞれ後の宣言が勝ち、`EXTRA_OFF` は EXTRA を解除します。旧 `GLV-*` 別名は未対応のままです。**判定幅は変えません**。カタログはこれらをゲージ条件としてだけ説明しています。

**優先順位。** 譜面のゲージはプレイヤーのゲージ選択を置き換え、2 人プレイでは両プレイヤーの選択を置き換えます。コースのステージはコースのゲージ規則を保ちます。ゲージの持ち越し方を決めるのは譜面ではなくコースだからです。NONSTOP はステージのオプションを持たない連結譜面を遊びます。beatoraja PRACTICE は自身のゲージを保ちます。プレイヤーのゲージオートシフトは譜面が設定しない別のオプションなので、譜面のゲージを起点に引き続き働きます。

**実行する場所。** engine はライブプレイの開始時に対応を適用し（`@be-music/player-engine/ruleset` の `resolveChartGaugeType`）、ブラウザは同じゲージを表示します（`resolveSelectedGauge`）。リプレイは記録した `play.gauge` で動くため、既存のリプレイのゲージが変わることはありません。このような譜面のリプレイは、遊んだゲージで再シミュレーションされます。

**記録。** `play.gauge` に実効ゲージを記録します。クリアランプは、プレイヤー自身の選択と同じく、その ruleset でのそのゲージのランプです。LR2 で HYPER の譜面は HARD CLEAR になります。ゲージは[アシスト規則](./0031-assist-record-policy.ja.md)上のアシストではないため、記録の対象可否は変わりません。

## 結果

譜面のゲージ指定は、どの ruleset・ホストでも決定的に遊べて記録され、ランプは各 ruleset のなじみのものになります。nanasigroove との違いは意図的です。BEGINNER の 70 % の境界は ruleset の EASY の境界になります。失敗のあるゲージで 90 % のクリア境界を持つ HYPER は ruleset の HARD になります。5 MISS まで許す DANGER は最初の BREAK で終わる DEATH になります。後で行を変えると新しいプレイのゲージは変わりますが、既存のリプレイは変わりません。
