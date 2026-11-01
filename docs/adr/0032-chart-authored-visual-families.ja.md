[English](./0032-chart-authored-visual-families.md)

# 0032: 譜面指定の HIDDEN・CHANGE-HS・CRAZY のサイズ / 揺れを Be-Music の式で実行する

## 背景

[ADR 0026](./0026-chart-authored-display-options.ja.md) は `#OPTION`・`#CHANGEOPTIONxx`・チャンネル `A6` のうち HI-SPEED だけを実行します。nanasigroove のマニュアルと [hitkey 氏のカタログ](https://hitkey.nekokan.dyndns.info/option.htm)は HIDDEN・CHANGE-HS・表示系 CRAZY の名前と一文の説明（「演奏すべきタイミングが近づくとノートが出現する」「ノートが徐々に加速する」）を載せていますが、しきい値・曲線・周期・乱数分布はありません（[調査](../research/chart-authored-options.ja.md)）。カタログ自身が推測と記す項目（`S-WARP`・`CHAOS`）もあります。#843 は、ネイティブとの一致を主張せずに Be-Music の式を文書化して実行することを求めています。同じ項目では譜面の指定がプレイヤー自身の設定に優先する、とオーナーが決めました。

表示系 CRAZY の一部（`STAR`・`SPIN`・`CLONE*`・`LINEMOVE*`・`YWAVE*`・`XYWAVE*`・`3DWAVE*`・`HIDJUDGE`・`DARK*`・`REVERSE`）は、スキン要素・判定ライン・プレイフィールド全体の向きを変えます。ブラウザの 4 系統とターミナルは、これらの部品を大きく異なる方法で描きます（判定ラインや判定表示は LR2 / beatoraja スキンが定義します）。

## 決定

**プログラムのプロファイル version 2。** `ChartOptionProgram.version` を 2 にし、状態に `hiSpeed` と並べて `hidden`・`changeHS`・`crazySize`・`crazyWave` を加えます。コンパイラは下表の系列について、大文字小文字が一致する現行の `774:HIDDEN_*`・`774:CHANGE-HS_*`・`774:CRAZY_*` ID を、初期宣言と A6 の両方で受理します。順序は既存どおりです（同時刻は正規化済み IR 順、後から受理した操作が勝つ）。`HIDDEN_OFF`・`CHANGE-HS_OFF` はその系列を、`CRAZY_OFF` は CRAZY の両サブ系列を解除します。同じ系列の後の値は前の値を置き換えます。リプレイの解析は、`hiSpeed` だけを持つ version 1 と、新しいフィールドを持つ version 2 を受け付けます。version 1 の記録が version 2 の系列を有効にすることはありません。旧 `HID-*`・`CRA-*` 別名、`HIDDEN_M-SUDDEN`（F3–F5 で操作する手動レーンカバー）、上記の CRAZY は引き続き `unsupported-option` として診断します。

**式。** いずれも `@be-music/chart-model` の純粋で決定的な関数です（`resolveChartNoteVisual`）。`p` はノートの接近度で、判定ラインで 0、レーン上端で 1 です。`t` は engine の表示用譜面時計（秒）です。「hash」はレーンのチャンネル、ノートの拍（マイクロ拍）、表記したシードから作る安定した 32 ビットハッシュを [0, 1) に写した値です。同じノートは、どのフレーム・シーク・リプレイ・ホストでも同じ値になります。

| 系列                               | 式                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HIDDEN`・`HIDDEN2`・`HIDDEN3`     | 不透明度 `clamp((p − f) / 0.05)`、`f` = 0.30・0.45・0.60                                                                                                                 |
| `SUDDEN`・`SUDDEN2`・`SUDDEN3`     | 不透明度 `clamp((c − p) / 0.05)`、`c` = 0.70・0.55・0.40                                                                                                                 |
| `HID-SUD`・`HID-SUD2`・`HID-SUD3`  | `p` = 0.5 を中心とする表示帯：不透明度 `clamp((h − abs(p − 0.5)) / 0.05)`、`h` = 0.15・0.10・0.05                                                                        |
| `MIST`・`DEEPMIST`                 | 不透明度 0.35・0.10                                                                                                                                                      |
| `BLINK`・`BLINK2`                  | 不透明度 `0.5 + 0.5 cos(2πt / T)`、`T` = 2 秒・4 秒                                                                                                                      |
| `STEALTH`                          | 不透明度 0                                                                                                                                                               |
| CHANGE-HS                          | `p > 0` の表示接近度は `bend(p · k)`。`bend(x) = x + b · x(1 − x)`（(0, 1) の範囲、それ以外は恒等）。常に `k ≥ 1` なので、ノートがレーン上端より下で突然現れることはない |
| `ACCEL`・`BRAKE`                   | `k` = 1、`b` = +0.5 / −0.5（判定ラインで 1.5 倍 / 0.5 倍の速さ）                                                                                                         |
| `LINE`・`LINE2`                    | `k = 1 + hash(lane)`。`LINE2` は 2 秒ごとに引き直す：`k = 1 + hash(lane, ⌊t/2⌋)`                                                                                         |
| `NAZO`・`NAZO2`・`LINENAZO`        | `k = 1.25 + 0.25 sin(2πt/4)`、`k = 1.5 + 0.5 sin(2πt/3)`。`LINENAZO` はレーンごとの位相 `hash(lane)` を加える                                                            |
| `RANDOM`・`RANDOM2`                | `k = 1 + hash(note)`。`RANDOM2` はノートごとに `b` = ±0.5 も選ぶ                                                                                                         |
| `COMBO-UP`・`COMBO-DN`・`COMBO-RD` | `r = min(1, combo / 200)`：`k = 1 + r`、`k = 2 − r`、`k = 1 + r · hash(note)`                                                                                            |
| `WARP`・`S-WARP`                   | `k = 1 + hash(⌊t/2⌋)`（2 秒ごとに譜面が跳ぶ）。`S-WARP` は `LINE` と `WARP` の平均                                                                                       |
| `LINEACCEL`・`CHAOS`               | `b` = +0.5 の `LINE2`。`LINE2`・`NAZO`・`RANDOM` の平均                                                                                                                  |
| CRAZY サイズ                       | `SMALL` 0.6 倍、`BIG` 1.4 倍、`FADEIN` `0.4 + 0.6(1 − p)`、`FADEOUT` `1 − 0.6(1 − p)`、`RD-SIZE` `0.5 + hash(note)`。レーン中央とノート下端を基準に拡縮する              |
| CRAZY 揺れ                         | レーン幅単位の横オフセット：`XWAVE` `0.25 · tri(2p)`、`XWAVE2` `0.5 · tri(3p)`。`tri` は 0 で 0 になる周期 1 の三角波なので、ノートは中央に着地する                      |

HIDDEN と CRAZY は CHANGE-HS 適用後の表示接近度を読むため、画面上の位置に作用します。LR2 のルールで判定ラインより下に留まるノートは `p = 0` として扱います。ロングノートはレーンの形を保ちます。CHANGE-HS は始点と終点を動かし、始点の HIDDEN 不透明度をノート全体に適用し、CRAZY のサイズ・揺れは単ノートと地雷にだけ適用します。

**優先順位。** 同じ項目では譜面の状態がプレイヤー自身の設定に優先します。これらの系列に対応する Be-Music のユーザー設定はレーンカバーだけです。ユーザーの SUDDEN+・HIDDEN+・LIFT は上に描いたまま残し、譜面の HIDDEN はユーザーの visual CONSTANT の不透明度に掛け合わせます。HI-SPEED と同じく、コースの速度ロックでは抑止しません。

**ホスト。** engine は状態を譜面時計上の `PlayerUIFramePayload.chartOptions` で配信します。ポーズ中は保持し、シークでは状態を持たずに検索し、LR2 の逆再生では凍結します。LR2 / 組み込みのプレイフィールド（be-music スキンのバインディングも兼ねる）と beatoraja のノートレイヤーは、すべてのノートを `placeChartNoteVisual` で配置します。ターミナルは CHANGE-HS をグリッドの行に適用し、HIDDEN の不透明度が 0.5 以上のノートだけを表示します。セル未満のサイズやオフセットはないため、CRAZY のサイズ・揺れは描きません。NONSTOP は HI-SPEED と同じく、各ステージの排他的な区間にこれらの状態を配置します。

**記録。** 表示専用です。ノート・判定・ゲージ・スコア・フィンガープリント・リプレイ入力を変えません。[ADR 0031](./0031-assist-record-policy.ja.md) ではアシストでも判定の変更でもないため、記録の対象可否を変えません。実効プログラムは `chart.chartOptions` に記録し、再シミュレーションでは無視します。

## 結果

これらの系列を使う譜面は、どのホストでも定義済みで再現可能な表示になり、古いリプレイは元の表示を保ちます。数値は Be-Music のもので、nanasigroove と異なる場合があります。記録されたプログラムは表示そのものではなく系列名を持つため、将来式を変えるには新しいプロファイルバージョンが必要です。判定ライン・判定表示・プレイフィールドの向きを変える CRAZY は、各系統が描けるようになるまで診断のままです。一覧は[対応範囲](../research/chart-authored-options.ja.md#対応範囲決定)にあります。
