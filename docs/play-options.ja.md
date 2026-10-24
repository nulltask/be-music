[English](./play-options.md)

# プレイオプション

Debug Menu の **Play options** と選曲画面は、実際に使う設定を共有します。新しいプレイに適用するオプションはプレイ中に変更できず、保存した設定は次回の起動で復元します。リプレイには選択した値と途中の変更を、実効譜面・表示・テンポとともに保存します。スコアの扱いは Leaderboard 側で別に決めます。実装では [#755](https://github.com/nulltask/be-music/issues/755) からリンクした各 Issue の仕様とコメントを参照します。

## START BPM HS-FIX

Debug Menu で **HS-FIX → STARTBPM** を選択します。既定は **OFF** のままです。START は MAX・MIN・MAIN とは別に、譜面のヘッダーにある開始 BPM をハイスピードの基準にします。`#BASEBPM` で基準速度を指定している場合の倍率は `基準 BPM / 開始 BPM` です。拍 0 の BPM 変更でヘッダーの開始 BPM を置き換えません。その後の BPM 変更ではスクロール速度も変化します。通常の表示速度オプションとして扱い、スコア・アシスト・コースの記録条件は変更しません。

モードと実際の描画ハイスピードをリプレイの表示設定に記録します。beatoraja スキンには元の START のオプション番号 1 を渡します。LR2 スキンでは既存の 5 種類の HS-FIX ボタン画像と循環順を維持するため、START は Debug Menu から選びます。スキン側でも共通のプレイオプション API で選択できます。

出典: beatoraja 0.8.9 の [`LaneRenderer.init`](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/LaneRenderer.java) と [`PlayConfig`](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/PlayConfig.java)。対応 Issue: [#736](https://github.com/nulltask/be-music/issues/736)。

## 表示エリア情報の常時表示

Debug Menu の **Display area info** で **OFF**（既定）、**ON**、**SUDDEN+ ONLY**、**HID+/LIFT ONLY** を選びます。「名前を言ってはいけないあのゲーム」AC 34 の画面にある 4 種類です。選んだ側の有効なカバーに、0〜1000 の長さと緑数字を START を押さずに表示し続けます。DP は各側のカバーと表示時間を使います。無効なカバーにはラベルを追加しません。OFF でもスキン自身の既存の表示はそのまま使えます。

同じフォルダーには既存の LR2 の **Effect 1P / 2P**、**Lane cover**、**Cover height** の設定もあり、スキンの種類を切り替えても設定を引き継ぎます。Native は DOM、Canvas・LR2・beatoraja は Canvas のラベルを使い、Canvas のキャプチャーにも含めます。表示の選択は保存する閲覧設定で、入力・判定・スクロール・リプレイの記録条件を変えません。この設定について、出典のページは追加の記録制限を示していません。

出典: AC 34 の [BPM 変化曲対策オプション](https://p.eagate.573.jp/game/2dx/34/howto/new/bpm_option.html)。4 種類の設定画面も参照しています。対応 Issue: [#748](https://github.com/nulltask/be-music/issues/748)。

## 左右別 AUTO SCRATCH

Debug Menu の **Auto scratch 1P / 2P** は、各側のスクラッチノートを独立して自動化します。反対側はロングスクラッチを含めて手動のままです。[#708](https://github.com/nulltask/be-music/issues/708) の左右別 AUTO SCRATCH に従います。リプレイは選択した設定一式と実効的な左右のスイッチを保持します。全体のスイッチだけを持つ旧リプレイでは両側に適用します。スコアの扱いは Leaderboard 側で決めます。
