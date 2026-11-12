[English version](./0041-chart-authored-base-speed.md)

# 譜面指定の BASE-SPEED を標準速度として扱う

nanasigroove 1.552 の旧 ID `774:CRA-RHS1`・`774:CRA-RHS2`・`774:CRA-RHS3` は、初期 `#OPTION` でそれぞれ 1.2・1.5・2.0 倍の再生速度を指定します。後の有効な初期指定が優先されます。`CRAZY_OFF` で解除されず、A6 に置いた場合は `initial-only-alias` を診断します。[参照資料](../research/chart-authored-options.ja.md) · [#1074](https://github.com/nulltask/be-music/issues/1074)

ブラウザーとターミナルの実再生速度は、譜面指定とプレイヤー指定の積です。ブラウザーの速度スライダーの範囲はプレイヤーの倍率に適用します。音声と BGA は実再生速度に従い、ブラウザーのピッチ維持モードではその速度でサンプルを事前に伸縮します。

譜面指定だけでプレイした場合、通常の記録・ランプ・Leaderboard の条件を適用します。プレイヤーが標準速度から変更した場合は練習扱いです。譜面の倍率は両 fingerprint 文書の `playOptions.baseSpeed` と、リプレイのバージョン 2 の `chart.chartPlayOptions` に入ります。`play.tempo` と `play.tempoChanges` は標準速度に対するプレイヤーの倍率です。以前のリプレイは記録済みのプログラムを使います。

通常のコースステージでは各譜面の BASE-SPEED を使います。NONSTOP は一つのプレイとして連結するため、ステージの指定は診断に残します。
