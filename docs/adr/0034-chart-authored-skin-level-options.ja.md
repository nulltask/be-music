[English](./0034-chart-authored-skin-level-options.md)

# 0034: 譜面指定の M-SUDDEN・スキン水準の CRAZY・旧別名をプレイフィールドの水準で実行する

## 背景

[ADR 0032](./0032-chart-authored-visual-families.ja.md) は HIDDEN・CHANGE-HS・CRAZY のサイズ / X 方向の揺れをプログラムのプロファイル version 2 で実行し、nanasigroove の残りの表示オプションを診断のままにしました。残りは、`HIDDEN_M-SUDDEN`（プレイヤーが F3〜F5 で動かすレーンカバー）、CRAZY の `STAR`・`SPIN`・`CLONE*`・`S-CLONE`・`LINEMOVE*`・`YWAVE*`・`XYWAVE*`・`3DWAVE*`・`HIDJUDGE`・`DARK*`・`REVERSE`、旧 `774:HID-*`・`774:CRA-*` の ID です。Issue #931 はこれらの実行を求めています。資料は各オプションを一文で説明するだけで（[hitkey のカタログ](https://hitkey.nekokan.dyndns.info/option.htm)：「ノートが虹色に光る」「各ノートの後ろに半透明の残像が出る」「判定ラインが上下に動き続ける」「一部の画面要素が表示されない」「譜面が上下逆に表示される」）、周期・振幅・色・配置・要素の一覧を示しません。オーナーは、同じ項目について譜面が指定したオプションがプレイヤーの設定より優先すると決めました。

このうちいくつかは、Be-Music のブラウザの 4 系統とターミナルで描き方の異なる部分を変えます。LR2・beatoraja のスキンは判定ライン・レーン背景・判定表示・ボムを自分で描きます。共通レンダラーが制御するのは、ノートの流れ、レーンカバーと LIFT、BGA のレイヤー、スキンに渡す判定とボムだけです。

## 決定

**プログラムのプロファイル version 3。** `CHART_OPTION_PROGRAM_VERSION` を 3 にします。`hidden` に `M-SUDDEN` を加え、CRAZY の揺れの系列に `YWAVE`・`YWAVE2`・`XYWAVE`・`XYWAVE2`・`3DWAVE`・`3DWAVE2` を加え、状態に排他的な CRAZY の項目を 7 つ加えます。`crazyColor`（`STAR`）、`crazySpin`（`SPIN`）、`crazyClone`（`CLONE`・`CLONE2`・`S-CLONE`）、`crazyLine`（`LINEMOVE`・`LINEMOVE2`）、`crazyJudge`（`HIDJUDGE`）、`crazyDark`（`DARK`・`DARK2`）、`crazyReverse`（`REVERSE`）です。`CRAZY_OFF` は表示系 CRAZY の項目をすべて解除します（これまでどおり [ADR 0033](./0033-chart-authored-gameplay-options.ja.md) の判定系 CRAZY も解除します）。リプレイの解析は version 1・2・3 を受け付け、記録自身より後の版の項目や値を拒否します。そのため version 1・2 のリプレイで version 3 のオプションが有効になることはありません。

**旧別名。** 旧 ID は hitkey のカタログに従って現行 ID に対応させます（`HID-HIDDEN1` → `HIDDEN_HIDDEN`、`HID-HIDJUDGE` → `CRAZY_HIDJUDGE`、`CRA-NORMAL` → `CRAZY_OFF`、`CRA-ACCEL` → `CHANGE-HS_ACCEL`、`CRA-HARD1` → `CRAZY_GOOD2BAD` など。`resolveChartLegacyOptionAlias`）。旧 HSP の値と同じく初期宣言でだけ受け付けます。A6 は旧 ID を無視するため、時刻付きの旧 ID は `initial-only-alias` と診断します。判定系の別名（`CRA-HARD1`・`CRA-HARD2`・`CRA-ULTHARD`・`CRA-2JUDGE`）は初期のプレイオプションに加わります。`CRA-RHS1/2/3`（再生速度の変更）と `CRA-HYPER`・`CRA-CPDOUBLE`（未対応の `NOTES_DOUBLE`・`NOTES_COPY` に当たる）は `unsupported-option` のままです。

**式。** すべて `@be-music/chart-model` の純粋で決定的な関数です（`resolveChartNoteVisual`・`resolveChartPlayfieldVisual`）。`p` は CHANGE-HS 後の表示上の接近度（判定ラインで 0、レーン上端で 1）、`t` はエンジンの表示用譜面時刻（秒）、`hash(note)` は ADR 0032 の安定したハッシュです。

| オプション              | 式                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `YWAVE`、`YWAVE2`       | 表示上の接近度 `p − a · sin(2πnp) / (2πn)`、`n` = 3 / 5、`a` = 0.8 / 1。傾きが 0 を下回らないため、ノートは戻らずに止まっては進む。判定ラインとレーン上端では動かない                       |
| `XYWAVE`、`XYWAVE2`     | 接近度に `YWAVE` / `YWAVE2`、さらに `XWAVE` / `XWAVE2` の横揺れ                                                                                                                             |
| `3DWAVE`、`3DWAVE2`     | サイズ倍率 `1 + 0.3 sin(4πp)` / `1 + 0.5 sin(6πp)`。判定ラインで 1。資料が推測として挙げる XY 成分は加えない                                                                                |
| `STAR`                  | ノートに乗算する色。色相 `frac(t / 1.5 + hash(note))`、彩度 0.55、明度 1                                                                                                                    |
| `SPIN`                  | ノートの中心を軸にした回転 `2π · frac(t + hash(note))`。毎秒 1 回転                                                                                                                         |
| `CLONE`                 | ノートの `0.08` 後ろ（上）に不透明度 0.4 の残像 1 つ                                                                                                                                        |
| `CLONE2`                | `CLONE` に加え、左右に 1 レーン幅ずらした不透明度 0.3 の残像                                                                                                                                |
| `S-CLONE`               | `CLONE2` に加え、判定ラインから上る残像（`1 − p`）と斜めに寄ってくる残像 2 つ（`±1.5p` レーン幅）。いずれも不透明度 0.25                                                                    |
| `LINEMOVE`、`LINEMOVE2` | 判定ラインをプレイヤーの LIFT に加えてレーンの `A · (1 − cos(2πt / T)) / 2` だけ上げる（最大 0.9）。`A` = 0.15 / 0.35、`T` = 4 秒 / 3 秒。`CRAZY_OFF` で元に戻す（nanasigroove とは異なる） |
| `HIDJUDGE`              | 判定表示（判定、それと一緒に出るコンボ、FAST / SLOW）を描かない。LR2 の SILENT の自動判定タイミングと同じ                                                                                   |
| `DARK`、`DARK2`         | `DARK` は BGA を隠す。`DARK2` は判定のボムも隠す                                                                                                                                            |
| `REVERSE`               | ノートの流れをレーン領域の中央で上下反転する。ノートは上端の判定ラインへ上っていく                                                                                                          |
| `M-SUDDEN`              | オプションが続く間、プレイヤー自身の SUDDEN+ カバーを、オンかどうかにかかわらず自身の高さで描く。F3 で下げ（覆う範囲を広げ）、F4 で上げる。1 回でレーンの 1 %（Shift で 5 %）               |

STAR・SPIN・CLONE は通常ノートに適用します。ロングノートはレーン上の形を保ち（Y 方向の揺れは CHANGE-HS と同じく始点と終点を動かす）、地雷は自分の色を保ちます。

**M-SUDDEN。** カバーはプレイヤー自身の SUDDEN+ です（hitkey のカタログは M-SUDDEN を LR2 の LANE-COVER としている）。そのため高さはプレイ状態とリプレイが記録する view にあり、リプレイはプレイヤーが動かした位置を再現します。譜面は表示を強制するだけで、プレイヤーがカバーをオンにしているかどうかは変えません。F3 / F4 の操作も高さだけを変えます。譜面がカバーを求めているため、コースがカバーを固定していても操作は受け付けます。F5 は Be-Music のリスタートのキーのままなので、リセットのキーはありません。

**ホスト。** エンジンは状態を `PlayerUIFramePayload.chartOptions` で公開するだけです（一時停止では保持し、シークでは状態を持たずに引き直し、LR2 の逆走では凍結する）。効果はすべて表示です。各系統は共通レンダラーが制御する部分に効果を適用し、それ以外はスキンの意味を作らずに効果なしとして記録します。

| 効果              | 組み込みの系統                                                              | LR2 スキン                                                     | beatoraja スキン                                       | ターミナル                                             |
| ----------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Y 方向の揺れ      | 描く                                                                        | 描く                                                           | 描く                                                   | ノートをレーン方向に動かす                             |
| 横揺れ、3D の揺れ | 描く                                                                        | 描く                                                           | 描く                                                   | 効果なし（セル未満の大きさやずれがない）               |
| STAR、SPIN        | テーマのセルと既定の図形（色のみ）。be-music スキン自身のノートでは効果なし | 描く                                                           | 描く                                                   | 効果なし（色の変化や回転がない）                       |
| CLONE             | 描く                                                                        | 描く                                                           | 描く                                                   | 効果なし                                               |
| LINEMOVE          | LIFT のあるスキン（Plain、Native）                                          | 効果なし。LR2 スキンには LIFT がなく、判定ラインをスキンが描く | スキンの LIFT を通す                                   | 効果なし                                               |
| HIDJUDGE          | 隠す                                                                        | 隠す（`NOWJUDGE` / `NOWCOMBO` と代替の文字）                   | `JUDGE_DISPLAY_HIDDEN` を通す                          | 判定の行を空にする                                     |
| DARK              | BGA を隠す                                                                  | BGA を隠す                                                     | BGA を隠す                                             | BGA を隠す                                             |
| DARK2（ボム）     | 隠す                                                                        | 隠す（ボムのタイマーを始めない）                               | 隠す（ボムのタイマーを外す）                           | 隠すボムがない                                         |
| REVERSE           | ノートのレイヤーを反転                                                      | ノートのレイヤーを反転。スキンの判定ラインとレーンはそのまま   | ノートと小節線のレイヤーを反転。スキンの部品はそのまま | グリッドを反転（判定の行が上）                         |
| M-SUDDEN          | カバーを描く、F3 / F4                                                       | カバーを描く、F3 / F4                                          | スキンのレーンカバー、F3 / F4                          | 効果なし。ターミナルにはプレイヤーのレーンカバーがない |

**記録。** 表示専用です。ノート・判定・ゲージ・スコア・フィンガープリント・リプレイ入力を変えません。[ADR 0031](./0031-assist-record-policy.ja.md) ではアシストでも判定の変更でもありません。M-SUDDEN のカバーの高さは、ほかのカバーの変更と同じくリプレイが記録する view に入ります。NONSTOP では version 2 の系列と同じく、各ステージの排他的な区間にこれらの状態を置きます。

## 結果

nanasigroove が挙げる表示オプションと旧 ID の表示系はすべて、定義済みで再現可能な表示で動き、古いリプレイは元の表示を保ちます。数値と要素の一覧（DARK や HIDJUDGE が隠すもの）は Be-Music のもので、変えるには新しいプロファイルバージョンが必要です。LR2・beatoraja のスキンでは REVERSE がノートの流れだけを動かすため、スキンの判定ラインは下に残ります。LINEMOVE は LR2 スキンでは効果がありません。これらを完全にするには、LR2・beatoraja のスキンが定義していないスキン側の対応が必要です。診断のままなのは `NOTES_*`・`GAMELEVEL_*`・`EXTRA_*`・`CRA-RHS*` と HDX の BGAMODE だけです（[対応範囲](../research/chart-authored-options.ja.md#対応範囲決定)）。
