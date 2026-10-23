[English](./play-options-audit.md)

# プレイオプションとアシスト扱いの調査

調査日：2026-10-24。Be-Music の照合対象は `424857f648b56dc1d1e06330bebeaefe18bcf3d1`。実装状態はソースコードで確認したもので、原作の筐体操作による検証ではありません。

## 対象と読み方

原作は LR2 beta3 100201、beatoraja 0.8.9（`83574048ba489082eb46df7fe9806b464bf1f526`）、名前を言ってはいけないあのゲームの AC 34 と PC 版の公式追加オプションを対象とします。過去版でしか確認できない機能は別記します。以下の比較表で「AC」「PC」は名前を言ってはいけないあのゲームの各版を指します。

- **実装済み**：選択・受け渡し・実行の経路があります。原作固有の操作方法まで完全互換という意味ではありません。
- **部分実装**：内部計算のみ、特定のスキンのみ、保存方針が不足、または代替動作です。
- **未実装**：現在の新規プレイで選択・実行できません。型・スキン ID・旧リプレイの値が残っているだけの場合も含みます。
- **未確認**：調べた一次資料では確認できません。機能が存在しないという断定ではありません。

アシストは単純な ON/OFF では表せません。原作における補助機能の分類、スコア・BP・コンボの更新、クリアランプの上限、保存先、ランキング対象を分けて読みます。ASSIST EASY などの**ゲージ**と、譜面変更の**アシストレベル**も別です。

LR2・beatoraja というスキンの種類と、`lr2`・`beatoraja`・`____` という判定ルールは独立しています。Be-Music のオプションは共通モデルから供給されます。beatoraja スキンを読み込んでも、原作の全オプションが有効になるわけではありません。

## オプション比較

原作側の根拠は後掲の [LR2 資料](#lr2)、[beatoraja 資料](#beatoraja)、[公式資料](#名前を言ってはいけないあのゲーム)です。実装側の根拠は [コード参照](#be-music-のコード参照)にまとめます。

| 項目                                        | LR2 原作                                              | beatoraja 0.8.9                                                              | AC 34 / PC                                             | Be-Music                                                                                            |
| ------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| OFF・MIRROR・RANDOM                         | 通常の配置設定                                        | 非アシスト                                                                   | AC の通常配置設定                                      | 実装済み                                                                                            |
| S-RANDOM                                    | 通常の配置設定                                        | 非アシスト。モード別の配置規則あり                                           | AC にあり                                              | 実装済み。ただし `____` の配置規則は暫定的に LR2 系を使用                                           |
| R-RANDOM                                    | 標準一覧では未確認                                    | 非アシスト                                                                   | AC にあり                                              | 未実装                                                                                              |
| SCATTER                                     | スコア保存制限・EASY 上限                             | H-RANDOM と似た目的だが同一配置規則とは限らない                              | H-RANDOM は PC・旧 AC で確認                           | 未実装・新規選択を無効化。旧リプレイの値は読める                                                    |
| CONVERGE                                    | 保存制限・EASY 上限                                   | PMS の CONVERGE は LIGHT ASSIST                                              | 通常設定では未確認                                     | 未実装                                                                                              |
| SPIRAL・H-RANDOM・ALL-SCR                   | 標準一覧では未確認                                    | LIGHT ASSIST                                                                 | H-RANDOM は PC で確認。AC 34 での掲載は未確認          | 未実装                                                                                              |
| RANDOM-EX・S-RANDOM-EX                      | 決定中の操作による特殊配置設定あり                    | スクラッチを含む配置で LIGHT ASSIST                                          | 同名の通常設定は未確認                                 | 未実装                                                                                              |
| PMS playable RANDOM 系                      | 標準一覧では未確認                                    | LIGHT ASSIST                                                                 | 対象外                                                 | 未実装                                                                                              |
| DP FLIP・左右別の配置変更                   | 通常設定                                              | FLIP は非アシスト                                                            | AC にあり                                              | 実装済み                                                                                            |
| BATTLE・D-BATTLE・BATTLE AS                 | 通常スコアとは異なる保存条件                          | 実際のプレイ経路では LIGHT ASSIST                                            | AC・PC の BATTLE はスコア保存なし                      | 未実装                                                                                              |
| SP-TO-DP・7→9 変換                          | SP-TO-DP あり、通常記録と区別                         | 7→9 変換は LIGHT ASSIST                                                      | 通常設定では未確認                                     | 未実装                                                                                              |
| 同期・対称 RANDOM、M-RAN                    | 2P 系の特殊設定あり。文字列だけで通常選択可とはしない | 同名の一般設定は未確認                                                       | AC に BATTLE 専用の同期・対称配置、2 人プレイ用 M-RAN  | 未実装                                                                                              |
| GROOVE / NORMAL・EASY・HARD                 | あり                                                  | あり                                                                         | あり                                                   | 実装済み。ルールごとにゲージを解決                                                                  |
| DEATH / HAZARD                              | DEATH                                                 | HAZARD                                                                       | AC の通常一覧には掲載なし                              | 実装済み。ただし `DEATH` 選択は beatoraja では HAZARD、`____` では EX-HARD に解決                   |
| ASSIST EASY / ASSISTED EASY                 | 標準一覧になし                                        | 選べる補助ゲージ                                                             | AC にあり                                              | 部分実装。計算・表示用定義はあるが、通常のゲージ選択肢にはない                                      |
| EX-HARD                                     | 標準一覧になし                                        | あり                                                                         | AC にあり                                              | 部分実装。計算はあるが、独立した通常 UI の選択肢はない。`____` の DEATH 選択経由とは区別            |
| P.ATTACK・G.ATTACK                          | あり。入力代行ではなく厳しいゲージ                    | 同じ通常選択肢は未確認                                                       | 通常設定では未確認                                     | 未実装                                                                                              |
| ゲージ自動シフト                            | beta3 標準では未確認                                  | NONE / CONTINUE / SURVIVAL TO GROOVE / BEST CLEAR / SELECT TO UNDER          | 通常設定では未確認                                     | 未実装                                                                                              |
| AUTO SCRATCH                                | スコア保存制限・EASY 上限                             | 単独の通常選択は未確認。BATTLE AS は確認                                     | AC で明示的なアシスト                                  | 部分実装。自動判定はあるが、保存方針と DP 左右別指定が不足                                          |
| LEGACY・LN REMOVE                           | 標準パネルとは別に MANIAC 系の LN 変更あり            | LN REMOVE は実際に変更すると ASSIST                                          | AC の LEGACY / AS&LEGACY                               | 未実装。LN を判定できることとは別                                                                   |
| ユーザー指定の LN / CN / HCN                | 譜面指定・MANIAC 系と区別                             | 未指定 LN のモードを選択可能                                                 | 原則譜面に規定。LEGACY と区別                          | 部分実装。譜面指定とコース制約はあるが、独立したプレイヤー設定はない                                |
| LN・CN・HCN の追加                          | MANIAC 系                                             | ADD LN 単独は非アシスト。ADD CN/HCN は実際の追加で ASSIST                    | 通常設定では未確認                                     | 未実装                                                                                              |
| 地雷の除去・追加                            | MANIAC 系                                             | REMOVE は除去対象があれば LIGHT ASSIST。追加だけではアシストフラグを立てない | 対象外                                                 | 未実装。地雷ノートの描画・判定とは別                                                                |
| ノート・キー音の追加                        | EXTRA / MANIAC 系。通常保存に制限                     | ExtraNote は実際に追加すると ASSIST                                          | 通常設定では未確認                                     | 未実装                                                                                              |
| HI-SPEED                                    | あり                                                  | あり                                                                         | NORMAL / FLOATING / CLASSIC                            | 基本機能は実装済み。20 段階や FHS の全操作を再現するものではない                                    |
| HS-FIX OFF・MAX・MIN・MAIN                  | OFF / MAX / MIN / AVERAGE                             | OFF / START / MAX / MAIN / MIN                                               | 同じ設定体系ではない                                   | 部分実装。MAX・MIN、AVERAGE 名の MAIN 基準はある。START はない                                      |
| LR2 HS-FIX CONSTANT                         | 保存制限あり。速度変更譜面では EASY 扱い              | 次の 2 項目と区別                                                            | 34 の表示補助と区別                                    | 部分実装・代替動作。選択名はあるが AVERAGE にフォールバックし、実際の一定速度化は未実装             |
| beatoraja の表示 CONSTANT                   | 対象外                                                | `PlayConfig.enableConstant`。0.8.9 のアシスト判定経路ではフラグを立てない    | 同等の独立設定は未確認                                 | 未実装                                                                                              |
| beatoraja の scroll REMOVE                  | CONSTANT と目的が似ても同じではない                   | BPM・STOP・SCROLL の変更対象があれば LIGHT ASSIST                            | 34 の表示補助とは別                                    | 未実装                                                                                              |
| HIDDEN・SUDDEN・HID+SUD、レーンカバー       | 非アシストの表示設定                                  | 非アシストの表示設定                                                         | HIDDEN+ / SUDDEN+ 等                                   | 実装済み。原作固有の名称・操作体系とは区別                                                          |
| LIFT・LIFT&SUD+                             | beta3 の標準にはなし                                  | 非アシストの表示設定                                                         | AC にあり                                              | 部分実装。beatoraja view で描画。built-in / LR2 view では未対応                                     |
| 緑数字・表示時間                            | あり、原作ごとに計算基準が異なる                      | duration 等あり                                                              | AC にあり                                              | 表示・計算・リプレイ再現は実装済み。FHS の完全互換ではない                                          |
| 手動の判定タイミング補正                    | あり                                                  | あり                                                                         | AC にあり                                              | 未実装。表示位置の offset や判定幅変更とは別                                                        |
| 判定タイミングの自動補正                    | OFF / ON / SILENT                                     | あり                                                                         | AC にあり                                              | 未実装                                                                                              |
| 判定アルゴリズム選択                        | 固有の判定規則                                        | Combo / Duration / Lowest を選択。Score は内部 enum                          | ユーザー設定として未確認                               | 部分実装。resolver / simulator に値はあるが Web の live 設定はない                                  |
| CUSTOM JUDGE・EXPAND                        | MANIAC 系の別設定と区別                               | PG / GR / GD・LN margin の拡張は ASSIST                                      | EXPAND は旧 AC・PC で確認。AC 34 の掲載は未確認        | 部分実装。core の単一判定幅 debug override のみで、多段・スクラッチ別拡張は未実装                   |
| BPM GUIDE                                   | 通常設定では未確認                                    | BPM 変化がある場合に LIGHT ASSIST                                            | AC 34 の予告機能とは別                                 | 未実装                                                                                              |
| tempo・frequency trainer・範囲練習・シーク  | tempo 変更には保存制限                                | 練習は通常記録と分離                                                         | モード・版限定の機能と区別                             | 部分実装。tempo・pause・AUTO / replay seek・manual practice seek はあるが、完全な範囲練習画面はない |
| BGA・音量・スコアグラフ                     | 非アシストの表示・音声設定                            | 非アシストの表示・音声設定                                                   | AC / PC に対応する設定あり                             | 基本機能は実装済み。ゴーストや配置・色など全表示設定の再現ではない                                  |
| 不可視ノート表示・処理済みノートの表示      | 通常設定とは区別                                      | 通常のアシスト変更とは別の表示設定                                           | 同等設定は未確認                                       | 実装済み。不可視ノートの表示はオプション有効時だけで、判定対象を増やさない                          |
| KEY ASSIST・ANY KEY                         | 通常パネルでは未確認                                  | 同名の標準設定は未確認                                                       | PC 専用。データ保存なし・NO PLAY                       | 未実装                                                                                              |
| 5KEYS アシスト                              | 5 鍵譜面のモードとは別                                | 譜面モードや変換と区別                                                       | 旧 AC 25 で確認。AC 34 では未確認                      | 未実装。5 鍵譜面をプレイできることとは別                                                            |
| BEGINNER の配置補正・リズム単純化           | 対応する機能は未確認                                  | 対応する同名機能は未確認                                                     | AC 33 の資料で確認。34 の継続・保存条件は未確認        | 未実装                                                                                              |
| BPM 変化予告・表示エリア固定・情報常時表示  | 対応する同名機能は未確認                              | 類似設定と区別                                                               | AC 34 の追加機能。公開説明ではアシスト保存条件は未記載 | 未実装。通常の BPM 表示・HS-FIX だけでは代替にならない                                              |
| 任意 seed・固定配置・ランダムレーンチケット | 隠し軸指定等と区別                                    | seed / replay 配置の機能あり                                                 | AC に国内限定のチケット機能                            | 部分実装。保存済み配置の replay 再現はあるが、新規プレイの seed / チケット選択 UI はない            |

## 原作のアシストと保存条件

### LR2

配布ヘルプと同梱 `history.txt` は SCATTER・CONVERGE・CONSTANT の保存制限を説明します。OpenLR2 の beta3 再構成では、アシストなどの条件で EASY を上限とするランプのみの更新経路があり、通常の EX スコア・BP・コンボ更新とは異なります。BATTLE・SP-TO-DP・EXTRA などには別の保存条件があります。すべてを「アシストなら全データを捨てる」という規則にまとめることはできません。[beta3 の保存判定](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L68-L79)、[記録更新](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L9334-L9364)。

この OpenLR2 は再構成資料です。現在の main に追加された機能を LR2 beta3 原作の機能とみなさず、同梱ヘルプ・変更履歴と突き合わせます。

### beatoraja

`AssistLevel` と、選べる ASSIST EASY ゲージは独立しています。通常スコア更新を禁止しても、LIGHT ASSIST / ASSIST の低位ランプが更新される場合があります。[実行時の集約](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/BMSPlayer.java#L201)、[ランプ決定](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/BMSPlayer.java#L869)、[記録更新](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/PlayDataAccessor.java#L423)。

| 原作での扱い                 | 対象・条件                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 非アシスト                   | MIRROR / RANDOM / R-RANDOM / S-RANDOM / FLIP。通常の速度・カバー・タイミング補正・判定アルゴリズム選択。表示だけの CONSTANT         |
| LIGHT ASSIST                 | SPIRAL / H-RANDOM / ALL-SCR / RANDOM-EX / S-RANDOM-EX / PMS CONVERGE / playable RANDOM 系。BATTLE の実行経路                        |
| 条件付き LIGHT ASSIST        | BPM GUIDE は BPM 変化あり。scroll REMOVE は BPM / STOP / SCROLL の変更あり。mine REMOVE は実際の除去あり                            |
| 条件付き ASSIST              | LN REMOVE・CN / HCN ADD・ExtraNote は実際の変更あり。Custom Judge は鍵盤またはスクラッチの PG / GR / GD または LN margin が 100% 超 |
| 変更だけではフラグを立てない | 地雷追加・SCROLL 追加・ADD LN。難易度を変えるという理由だけで、アシストと推定しない                                                 |

譜面変更の根拠は [Randomizer](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/pattern/Randomizer.java#L155)、[各 modifier](https://github.com/exch-bms2/beatoraja/tree/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/pattern)です。最終の実行側の判定を優先します。たとえば BATTLE の modifier 自体の属性だけから実行時アシストレベルを断定しません。

### 名前を言ってはいけないあのゲーム

AC 34 の公式ページは AUTO SCRATCH・LEGACY・両者の併用をアシストとして掲載します。BATTLE はスコア保存なしと明記します。ASSISTED EASY はゲージ設定の項目です。公開ページにない個々の保存上限を、別の版の挙動から補完しません。[AC 34 のオプション](https://p.eagate.573.jp/game/2dx/34/howto/play/option.html)。

PC 版は H-RANDOM・BATTLE・KEY ASSIST・ANY KEY の使用時にデータ保存なし・NO PLAY と明記しています。「補助機能なので必ずアシストランプを保存できる」と推定してはいけません。[PC 追加オプションと成績](https://p.eagate.573.jp/game/infinitas/2/howto/option.html)。

## Be-Music の記録上の課題

1. **ローカル自己ベストとランキングのアシスト区分が一致しません。** `ReplayAssistFlag` は `auto-scratch` と `judge-window-override` のみです。ランキングはこれらを通常プレイと分けますが、ローカルの自己ベストキーと `playKeepsRecord` には同じ区分がありません。
2. **原作のアシスト由来ランプを表現できません。** `CLEAR_LAMPS` の `ASSIST_EASY` はゲージ由来の対応であり、beatoraja の LIGHT ASSIST / ASSIST を完全に表せるという意味ではありません。
3. **AUTO SCRATCH の左右別設定が engine 入口で統合されます。** Web の 1P / 2P 設定は `autoScratch1P || autoScratch2P` で単一の値になります。DP の片側だけのアシストや、そのリプレイ上の表現は部分対応です。
4. **内部定義やスキン ID の存在だけでは実装済みにできません。** ゲージ拡張、LN モード、R-RANDOM、アシストボタン、LIFT などは選択から実行・保存までを追う必要があります。
5. **新しい変更オプションには再シミュレーション用の事実が必要です。** 条件付きアシストは譜面の BPM 変化・LN・地雷等にも依存します。選択名だけでは記録の分類を再現できません。

AUTO・別 tempo・シーク後の practice は通常記録を残さない経路があり、AUTO SCRATCH などのアシスト扱いとは分けます。通常の表示設定、譜面改変、練習プレイを同じ bool に押し込みません。

### 対応順序の提案

これは実装方針の提案であり、決定済みの仕様ではありません。

1. [#602](https://github.com/nulltask/be-music/issues/602) のルール別アシスト分類・スコア更新・ランプ上限・ローカルとランキングの分離を決めます。関連する [#603](https://github.com/nulltask/be-music/issues/603) のランプ語彙と保存済み値の扱いも合わせます。
2. 現行 AUTO SCRATCH と判定幅 override に同じ分類処理を適用し、ローカル・コース・ランキングで一貫させます。
3. R-RANDOM、ゲージの独立選択、LIFT の全スキン対応などを追加します。LN モードは [#604](https://github.com/nulltask/be-music/issues/604) の記録キーの区別を先に扱います。
4. LEGACY・地雷除去・追加ノート・実際の CONSTANT / scroll REMOVE 等を、保存・リプレイの契約と一緒に追加します。

## 出典

### LR2

- 配布 ZIP：`/Users/seiya/Downloads/LR2_100201.zip`。`LR2beta3/help/4.html`、`LR2beta3/LR2files/Help/playoption.txt`、`systemoption.txt`、`LR2files/Config/optionstr.csv`。
- ローカル同梱資料：`/Users/seiya/Downloads/bms/LR2beta3/history.txt`（UTF-8、SHA-256 `f1c39d76648c6f3fe35ece7d4c5f75b8ab9db1ef3b0c6044996b7af9df2a9b59`）。421–422 行は CONSTANT / SCATTER / CONVERGE、539–540 行は SP-TO-DP 等の保存条件を説明します。
- `/Users/seiya/Downloads/bms/LR2beta3/LR2files/Config/optionstr.csv`（CP932、SHA-256 `a98fe6aafb74cd0bae698e73fd304785241c072061c9f4dc2f3aa110e668fe93`）。文字列の列挙だけを選択・実行可能の証拠とはしません。
- [OpenLR2 の beta3 再構成](https://github.com/GOMazk/OpenLR2/tree/583a38503555e59c4bafa49d60b9d0714c9007c2)。

### beatoraja

- [0.8.9 の選択項目](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/launcher/PlayConfigurationView.java#L297)。
- [実行時のオプション適用・アシスト分類](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/BMSPlayer.java#L201)。
- [譜面変更の列挙](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/pattern/Random.java)、[表示処理](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/LaneRenderer.java)。

### 名前を言ってはいけないあのゲーム

- [AC 34 稼働告知](https://www.konami.com/arcadegames/corporate/ja/topics/2026/0916/)。
- [AC 34 オプション](https://p.eagate.573.jp/game/2dx/34/howto/play/option.html)、[ハイスピード](https://p.eagate.573.jp/game/2dx/34/howto/play/option_speed.html)、[テンキー設定](https://p.eagate.573.jp/game/2dx/34/howto/play/tenkey.html)。
- [AC 34 BPM 変化曲対策](https://p.eagate.573.jp/game/2dx/34/howto/new/bpm_option.html)、[ランダムレーンチケット](https://p.eagate.573.jp/game/2dx/34/howto/lightning_model/random_lane.html)。
- [PC 追加オプション](https://p.eagate.573.jp/game/infinitas/2/howto/option.html)。
- 過去版：[AC 33 BEGINNER 補正](https://p.eagate.573.jp/game/2dx/33/howto/new/beginner.html)、[AC 26 EXPAND-JUDGE](https://p.eagate.573.jp/game/2dx/26/howto/play/option.html)、[AC 25 オプション](https://p.eagate.573.jp/game/2dx/25/p/howto/play/option.html)。旧版掲載を現行搭載の根拠にはしません。

### Be-Music のコード参照

次のパスは上記調査コミット時点を指します。

- [共通オプション](../packages/player-scene-model/src/play-options/options.ts)、[選択肢と無効な値の処理](../packages/player-scene-model/src/play-options/choices.ts)。
- [Web メニュー](../packages/app-play/src/ui/debug-menu/play-options.ts)、[プレイへの受け渡し](../packages/app-play/src/app/play-scene-options.ts)。
- [配置変更](../packages/player-engine/src/lane-random.ts)、[ゲージ型](../packages/player-engine/src/ruleset/gauge-type.ts)、[ルール定義](../packages/player-engine/src/ruleset/definitions.ts)。
- [スキンごとの LIFT 対応](../packages/player-browser/src/host/play.ts)、[表示状態の再現](../packages/player-browser/src/session/play/play-view-settings.ts)、[オートスクラッチの集約](../packages/player-browser/src/session/play/play-engine.ts)。
- [判定幅の debug API](../packages/player-engine/src/core/engine-types.ts)、[ランプ](../packages/player-engine/src/ruleset/clear-lamp.ts)、[記録更新条件](../packages/player-engine/src/records/best-record.ts)、[ローカル記録キー](../packages/app-play/src/chart-best-records.ts)。
- [ランキング資格とアシストフラグ](../packages/player-engine/src/replay/eligibility.ts)、[ランキング保存](../packages/app-leaderboard/src/scores/submit.ts)。

既存の [LR2 / beatoraja セマンティクス調査](./semantics-lr2-beatoraja.ja.md)は異なる時点の資料です。SCATTER の新規選択無効化など、その後の変更は今回のコード照合を優先します。
