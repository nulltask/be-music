[English version](./0043-lrx-charts.md)

# LRX 譜面を独自の形式として読む

plugout4 -ARCADE EDITION- は、プレイヤー独自の形式である LRX で譜面を配布しています。1 譜面は `.lrs` のシーケンス、その隣の `.lrh` のヘッダ、`.lrm` の BGA ファイルからなり、どれも XML です。規則は BMS とも bmson とも違います。タイミングは 1 拍 480 の tick で数え、小節線は描くためだけにあります。サンプルは同じチャンネルの次のノーツで止まらず最後まで鳴るので、BMS のように 1 スロット 1 音でも、bmson のような切り出しでもありません。ノーツごとに音量、パン、速さ、エンベロープ、切り出しを持ちます。ロングノーツの終点も判定します。譜面の種類は、使っているレーンではなく `.lrh` の `lanetype` で決まります。[format-compat §7](../format-compat.ja.md#7-lrx) を参照してください。

Be-Music は LRX を 3 つ目の元形式 `sourceFormat: 'lrx'` として読みます。BMS や bmson に見せかけると、LRX にない規則まで持ち込むことになるためです。パーサは LRX を BMS のチャンネルと Be-Music の位置に変換するので、タイミング、BGA、判定のコードは 1 つのイベントの形のままです。LRX が足すものはその隣に置きます。ノーツごとの値は `BeMusicEvent.lrx`、ヘッダの値は `BeMusicJSON.lrx` です。BMS か bmson かで分かれるコードは、LRX をどちらでもないものとして扱います。

`lanetype` は `.pms` や bmson の keyboard の指定と同じく、レーン構成の入力です。`resolveChartPlayVariant` はレーンの規則より先にこれを読み、fingerprint もレーン構成の入力として持ちます。そうしないと、2P のスクラッチと 1 鍵目を使わない 10 鍵の譜面が PMS と判定されてしまいます。ロングノーツは CN です。plugout がその終点を数え、判定するためです。

この変更は形式を読むところまでです。ノーツごとの音のパラメータは `TimedSampleTrigger` の値（音量、バランス、再生速度、再生範囲、フェード）としてどのプレイヤーにも届きます。チェインノーツは、plugout と同じく直前のノーツを鳴らした押下に続けて鳴らします。ランクと TOTAL は既存の ruleset が LR2 の `#RANK` と絶対値の TOTAL として読みます。リプレイと Leaderboard は、当面 LRX 譜面の形式を `bms` として記録します。これらはそれぞれ別の変更で扱います。
