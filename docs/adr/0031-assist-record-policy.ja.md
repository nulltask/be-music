[English](./0031-assist-record-policy.md)

# 0031: アシストはオプションの参照元で区分し、結果は判定ルールで決め、ランプは追加専用にする

## 背景

プレイオプションはどの判定ルールでも選べるようになり（[#774](https://github.com/nulltask/be-music/issues/774)、[ADR 0019](./0019-source-qualified-option-values.ja.md)）、1 つのプレイに LR2・beatoraja・名前を言ってはいけないあのゲームのオプションが混ざることがあります。アシストを受けたプレイが何を残すかは 3 つの参照元で異なります。LR2 はランプを EASY までに制限してスコアを保存せず、D-BATTLE・SP TO DP・EXTRA MODE は別のランプに残します（OpenLR2 `LR2f.cpp` L9196-L9364）。beatoraja 0.8.9 はアシストを受けてクリアしたプレイに LIGHT ASSIST EASY か ASSIST EASY を与え、スコアの更新を止めます（`BMSPlayer.createScoreData`、`PlayDataAccessor.updateScore`）。AC 34 はアシストオプションを挙げ、BATTLE のデータは保存せず、PC 版は 4 つのオプションを NO PLAY にします。この変更より前のランキングのフラグは AUTO SCRATCH とデバッグ用の判定幅上書きだけでした。ローカルの記録はアシストをまったく見ておらず、Leaderboard はランプを番号で保存しているのに、`CLEAR_LAMPS` には LIGHT ASSIST EASY がありませんでした。

メンテナーの決定（[#602](https://github.com/nulltask/be-music/issues/602)、[#603](https://github.com/nulltask/be-music/issues/603)）は、各判定ルールがそのルール自身の規則に従うこと、オプションはその参照元で区分すること、保存済みの記録は導き直さないことです。

## 決定

**2 段階、判定は 1 つ。** `@be-music/player-engine/records` の `classifyReplayAssists` が、リプレイに記録したオプションと譜面の事実から該当するものを集めます。それぞれをオプションの参照元で `light`・`assist`・`no-save` に区分し、プレイは最も重い区分になります。続いて `resolveRecordPolicy` が判定ルールごとに別々の出力を返します。記録を残すか、スコアの項目を更新するか、ランプの規則（上限か置き換えか）、記録の枠、コースでの扱い、Leaderboard での置き場所、リプレイを残すかです。この判定はランタイムに依存せず決定的で、記録した値だけを読みます。ローカルの記録、リザルトのランプ、コースの記録、Leaderboard への送信と再シミュレーションはすべてこれを呼びます。オプションごとの表は[プレイオプション](../play-options.ja.md#アシストと記録の方針)にあります。

- 2 つの参照元が定義する素の値は、ADR 0019 の読み方どおりプレイした判定ルールのものです。譜面の内容で変わる beatoraja の規則は、記録した変更数と BPM の範囲を使います。
- `light` と `assist` はどの判定ルールでもランプだけを残します。LR2 は EASY まで、beatoraja はクリアを LIGHT ASSIST EASY か ASSIST EASY に、`____` は ASSIST EASY（AC の ASSIST CLEAR）に置き換えます。`no-save` は何も残しません。アシストを受けたステージがあるコースは、コースの記録を残しません。
- Leaderboard にはこれまでどおり AUTO とリプレイの再生以外のすべてのプレイが届きます。`light` と `assist` はアシストありのランキングに載り、`no-save` のプレイとアシストを受けたコースはランキング対象外として保存します。

**保存するランプの番号は追加専用。** LIGHT ASSIST EASY はランプの順序どおり、`CLEAR_LAMPS` の ASSIST EASY と EASY の間に入ります。保存する番号は MAX の後の 10 で、0〜9 はそれぞれのランプのままです。`clearLampRank` は保存する番号を返し、これはもう順序ではありません。比較には `compareClearLamps` と `compareClearLampRanks` を使い、ランプを並べる SQL は番号 10 を 2 と 3 の間の並べ替えキーに対応させます。beatoraja の ASSIST EASY ゲージでのクリアは、beatoraja の `ClearType` がゲージ 0 を対応させているとおり LIGHT ASSIST EASY になります。

**導き直さない。** 変更前に保存したローカルの自己ベストと Leaderboard の結果は値をそのまま残します。以前の beatoraja の ASSIST EASY ゲージでのクリアは ASSIST EASY（番号 2）のままです。`score.unranked` の新しい値（`no-save`）と `course_score.unranked` の新しい値（`assist`）は NULL を許すテキストの列に入るので、データの移行は要りません。

## 影響

- 新しいオプションは、参照元による区分と方針の表の行がなければマージしません。
- 保存したランプの番号は並べ替えてはいけません。今後のランプは次の空き番号を使い、ランプを並べる箇所はすべて比較関数を通します。
- LR2 の別ランプはローカルにだけあります。Leaderboard はこれらのプレイをアシストありのランキングに載せ、`lr2` では制限しないランプを付けます。
- AC がアシストオプションのスコアをどう扱うかは、出典のページに書かれていません。Be-Music は LR2 と beatoraja に合わせて止めます。よりよい出典があれば、この規則だけを変えられます。
