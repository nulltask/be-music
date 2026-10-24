[English](./play-options.md)

# プレイオプション

Debug Menu の **Play options** と選曲画面は、実際に使う設定を共有します。新しいプレイに適用するオプションはプレイ中に変更できず、保存した設定は次回の起動で復元します。実装では [#755](https://github.com/nulltask/be-music/issues/755) からリンクした各 Issue の仕様とコメントを参照します。

## START BPM HS-FIX

Debug Menu で **HS-FIX → STARTBPM** を選択します。既定は **OFF** のままです。START は MAX・MIN・MAIN とは別に、譜面のヘッダーにある開始 BPM をハイスピードの基準にします。`#BASEBPM` で基準速度を指定している場合の倍率は `基準 BPM / 開始 BPM` です。拍 0 の BPM 変更でヘッダーの開始 BPM を置き換えません。その後の BPM 変更ではスクロール速度も変化します。通常の表示速度オプションとして扱い、スコア・アシスト・コースの記録条件は変更しません。

モードと実際の描画ハイスピードをリプレイの表示設定に記録します。beatoraja スキンには元の START のオプション番号 1 を渡します。LR2 スキンでは既存の 5 種類の HS-FIX ボタン画像と循環順を維持するため、START は Debug Menu から選びます。スキン側でも共通のプレイオプション API で選択できます。

出典: beatoraja 0.8.9 の [`LaneRenderer.init`](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/LaneRenderer.java) と [`PlayConfig`](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/PlayConfig.java)。対応 Issue: [#736](https://github.com/nulltask/be-music/issues/736)。
