[English version](./code-vocabulary.md)

# コード内ドメイン用語の整理案

この文書はコードで使われる語を、概念・現行名・意味の違いに分けて整理した対応表です。[用語集](./glossary.ja.md)の定義と合わせて確認します。

## 譜面とアセット

| 概念                                | 現行のコード名                                          | 意味・区別                                                                       |
| ----------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| chart / 譜面                        | `BeMusicJSON`, `ResolvedChart`, `LibraryChart`          | ソース文書・解決済みデータ・ライブラリ項目という異なる表現。同じ型にまとめない。 |
| track / 楽曲                        | `metadata.title`, `metadata.artist`                     | メタデータから楽曲の一意な ID を推定しない。                                     |
| chart set / 譜面セット              | `chartset`                                              | 差分を含む、外部 ID を持つ譜面のまとまり。譜面そのものやフォルダとは別。         |
| chart file / 譜面ファイル           | `chartPath`, `fileSha256`, `fileMd5`                    | ファイルの所在とバイト列の識別。フィンガープリントとは別。                       |
| chart collection / 譜面コレクション | `BrowserChartCollection`, `BrowserChartCollectionStore` | 読み込んだ譜面・アセット供給元・エラー・コースフォルダ。                         |
| asset source / アセット供給元       | `BrowserAssetSource`, `sourceId`                        | 複数の譜面で共有できるファイル群の供給元。                                       |
| asset entry / アセット項目          | `BrowserAssetEntry`                                     | バイト列または遅延読み込みするファイル参照。譜面とは別。                         |
| resource / リソース                 | `#WAV`, `#BMP`, `sound_channels`                        | 譜面・スキンが参照する対象。アセット項目がその実体を供給する。                   |
| chart identity / 譜面の同一性       | `chartFingerprint`, `playFingerprint`, `sha256`, `md5`  | 譜面・選択分岐・ファイルの識別を分ける。演奏結果の ID とは別。                   |

## プレイ・判定・記録

| 概念                                                | 現行のコード名                                           | 意味・区別                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| play / プレイ                                       | `manualPlay`, `autoPlay`                                 | 1 回の実行。単体プレイ・コースステージ・コース全体を明示する。                             |
| play result / プレイ結果                            | `PlayResult`, `PlayerSummary`                            | 画面向けの結果とエンジンの集計。関連するが同じ型・役割ではない。                           |
| score / 得点                                        | `ScoreSummary.score`, `exScore`, `ScoreSummary`          | 表示得点・EX-SCORE・判定集計を分ける。表示得点はルールセットに依存する。                   |
| play submission / プレイ送信記録                    | `score`, `submissionId` in Leaderboard                   | score テーブルは数値ではなく送信済みプレイを保持する。送信 ID とプレイ ID の役割を分ける。 |
| ruleset result / ルールセット別結果                 | `scoreResult`, `ReplayRulesetResult`                     | 1 つのルールセットでの評価。実際に遊んだ規則と再シミュレーションを区別する。               |
| best record / 自己ベスト                            | `BestRecord`, `bestScore`, `BeMusicChartBestRecord`      | 複数プレイから項目ごとに保持する最良値。単一のベストプレイではない。                       |
| replay / リプレイ                                   | `BeMusicReplay`, `recordReplay`, `serializeReplay`       | 再現用の入力記録。含まれる結果キャッシュは再計算できる。                                   |
| judgment / 判定                                     | `JudgmentKind`, `JudgmentTiming`, `ReplayJudgmentCounts` | 判定の種類・時刻付き判定・判定数を区別する。種類・時刻・集計という役割を名前でも区別する。 |
| ruleset / ルールセット                              | `RulesetId`, `judgeRuleset`, `playedRuleset`             | リプレイ専用ではなくプレイ全体の規則。playedRuleset は実際に遊んだ規則。                   |
| gauge / ゲージ                                      | `GaugeType`, `gaugeType`, `gauge`, `cleared`, `lamp`     | 選択した方式・規則上のゲージ・残量・クリア判定・クリアランプを分ける。                     |
| arrangement / レーン配置                            | `randomLane`, `laneOption`, `randomDraws`                | レーンのランダム化と BMS 制御構文の分岐抽選を区別する。                                    |
| tempo / テンポ                                      | `speed`, `PlayerTempoChange`, `hiSpeed`, `hsFix`         | 再生テンポ・表示スクロール速度・その補正を区別する。                                       |
| judgment rank / 判定ランク                          | `judgeRank`, `rank`, `exRank`, `RulesetJudgeRankFacts`   | 判定幅の厳しさ。ランキング順位や DJ RANK とは別。                                          |
| DJ Rank / DJ RANK                                   | `IIDXRankLabel`, `resolveIIDXRankLabel`                  | EX-SCORE 率による評価。grade というコース種別とは別。                                      |
| chart level and difficulty / 譜面レベルと難易度区分 | `playLevel`, `difficulty`, `difficultyFilter`            | 作者が設定したレベルの値と BEGINNER〜INSANE の区分を分ける。                               |

## コースとレイアウト

| 概念                                        | 現行のコード名                                                  | 意味・区別                                                                               |
| ------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| course / コース                             | `CourseDefinition`, `RandomCourseDefinition`, `LibraryCourse`   | 固定された定義・抽選の定義・ライブラリでの表示を区別する。                               |
| course stage / コースステージ               | `CourseStageRef`, `LibraryCourseStage`, `stage`                 | ステージの参照先をローカル譜面に解決する。描画領域とは別。                               |
| course run / コースプレイ                   | `CourseRun`, `courseRun`, `PlayRunKind`                         | コースの 1 回の実行。NONSTOP は複数の演奏を順次行う形ではなく連結した単一プレイ。        |
| design stage / デザイン領域                 | `BeMusicStage`, `portraitStage`                                 | デザイン上のキャンバス寸法・BGA 配置。コースのステージとは別。                           |
| play variant / キー構成                     | `ChartPlayVariant`                                              | キー数の大分類。チャンネル配置とは分ける。                                               |
| play-mode layout / プレイモードのレイアウト | `PlayModeLayoutId`, `PlayModeLayout`, `PlayLane`                | 具体的なレーン・チャンネル対応。1 つのキー構成に複数の配置があり得る。                   |
| course kind / コース種別                    | `CourseKind`, `RulesetCourseKind`, `grade`, `expert`, `nonstop` | grade は段位認定。CLASS は外部のゲージ名・制約名として現れる。外部表記を一括で揃えない。 |

## ライブラリと表示

| 概念                        | 現行のコード名                                       | 意味・区別                                                                    |
| --------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| library / ライブラリ        | `Library`, `LibraryChart`, `LibraryEntry`            | 一覧する集合・譜面項目・一覧の 1 項目。一覧の項目にはフォルダやコースも含む。 |
| browse state / ブラウズ状態 | `BrowseState`, `BrowseSnapshot`                      | 現在の移動・絞り込み状態と、復元用スナップショット。                          |
| play options / プレイ設定   | `PlayOptions`, `PlayerOptions`, `PlayerPlaySettings` | 選曲画面の選択肢・エンジンの実行設定・記録される設定を区別する。              |
| scene / シーン              | `SessionScene`, `PixiSceneHost`, `SceneFamily`       | 画面の実行・そのホスト・スキンの種類という役割を分ける。                      |
| scene model / シーンモデル  | `BrowseState`, `PlayState`, `PlayResult`             | レンダラーに依存しない状態・データ。画面の制御自体とは別。                    |
| skin / スキン               | `BeMusicSkin`, LR2 and beatoraja skins               | 表示の実装。テーマは複数のスキンや音をまとめられる。                          |
| frame / フレーム            | `BeMusicGameplayFrame`, `BeMusicAudioFrame`          | 画面フレーム・音声フレームを明示する。データも時間軸も異なる。                |

## ユーザーと認証

| 概念                                    | 現行のコード名                                          | 意味・区別                                                                               |
| --------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| identity / 認証上の同一性               | `Identity.issuer`, `Identity.sub`, `userId`             | OIDC の issuer と subject の組と、サービス内の対応先ユーザー ID を区別する。             |
| linked login account / 外部ログイン連携 | `account`, `accountId`, `providerId` in Accounts schema | プロバイダーとの対応。be-music の別ユーザーや Cloudflare アカウントとは別。              |
| profile / プロフィール                  | `profile`, `handle`, `displayName`, `avatarKey`         | ユーザーの公開上の見せ方。変更しても同一性は変わらない。                                 |
| authentication session / 認証セッション | `LoginSession`, Better Auth session                     | アプリ・Accounts の認証状態と、画面・音声のセッションを区別する。                        |
| guest / ゲスト                          | `isAnonymous`, `Identity.anonymous`, `linkedGuests`     | 永続資格情報のないユーザーと、その引き継ぎ先との対応。ユーザーが存在しない意味ではない。 |

## API の命名

- リプレイ: `BeMusicReplay`、`parseReplay`、`serializeReplay`、`simulateReplay`。公開入口は `@be-music/player/replay`。
- 譜面: `PlayResult.chart`、`BrowserChartCollection`、`BrowserChartCollectionStore`。
- アセット供給元: `BrowserAssetSource`、`BrowserAssetEntry`。
- 譜面の自己ベスト: `BeMusicChartBestRecord`、`chartBestRecord`、`parseChartBestRecords`。
- 判定: `JudgmentKind`、`JudgmentTiming`、`ReplayJudgmentCounts`。
- ルールセット: `RulesetId`。
- スキンのデザイン領域: `BeMusicStage` を維持する。

旧名の互換エイリアスは設けません。BMS・bmson・外部サービスで要求される名前は維持します。`score` などの DB テーブル名は数値得点と区別して説明し、意味が違う `PlayOptions` と `PlayerOptions` は統合しません。

## 確認したコード

- [packages/scene-model/src/library/entries.ts](../packages/scene-model/src/library/entries.ts)
- [packages/scene-model/src/play-result/result.ts](../packages/scene-model/src/play-result/result.ts)
- [packages/player-web/src/collection/types.ts](../packages/player-web/src/collection/types.ts)
- [packages/player/src/course/definition.ts](../packages/player/src/course/definition.ts)
- [packages/player/src/ruleset/score.ts](../packages/player/src/ruleset/score.ts)
- [packages/player/src/records/best-record.ts](../packages/player/src/records/best-record.ts)
- [packages/player/src/replay/format.ts](../packages/player/src/replay/format.ts)
- [packages/skin-sdk/src/chart.ts](../packages/skin-sdk/src/chart.ts)
- [packages/skin-sdk/src/types.ts](../packages/skin-sdk/src/types.ts)
- [packages/leaderboard-api/src/db/schema.ts](../packages/leaderboard-api/src/db/schema.ts)
- [packages/accounts/src/schema.ts](../packages/accounts/src/schema.ts)
- [packages/auth-client/src/index.ts](../packages/auth-client/src/index.ts)
- [packages/chart/src/play-modes.ts](../packages/chart/src/play-modes.ts)
