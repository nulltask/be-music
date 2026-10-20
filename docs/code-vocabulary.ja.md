[English version](./code-vocabulary.md)

# コード内ドメイン用語の整理案

この文書はコードで使われる語を、概念・現行名・意味の違いに分けて整理したレビュー用の対応表です。下の改名候補は未実装です。[用語集](./glossary.ja.md)の定義と合わせて確認します。

楽曲の正規語は `track` とし、新しい型・参照には `Track`・`trackId` を使います。下のメタデータは現行コードとの対応であり、既存の楽曲エンティティを示すものではありません。譜面は `chart`、音声ファイルは `audio asset` と区別します。

## 譜面とアセット

| 概念                                | 現行のコード名                                         | 意味・区別                                                                                    |
| ----------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| chart / 譜面                        | `BeMusicJSON`, `ResolvedChart`, `LibraryChart`         | ソース文書・解決済みデータ・ライブラリ項目という異なる表現。同じ型にまとめない。              |
| track / 楽曲                        | `metadata.title`, `metadata.artist`                    | メタデータから楽曲の一意な ID を推定しない。                                                  |
| chart set / 譜面セット              | `chartset`                                             | 差分を含む、外部 ID を持つ譜面のまとまり。譜面そのものやフォルダとは別。                      |
| chart file / 譜面ファイル           | `chartPath`, `fileSha256`, `fileMd5`                   | ファイルの所在とバイト列の識別。フィンガープリントとは別。                                    |
| chart collection / 譜面コレクション | `BrowserSongCollection`, `BrowserSongCollectionStore`  | 読み込んだ譜面・アセット供給元・エラー・コースフォルダ。Song は楽曲ではなく譜面を指している。 |
| asset source / アセット供給元       | `BrowserSongAssetSource`, `sourceId`                   | 複数の譜面で共有できるファイル群の供給元。                                                    |
| asset entry / アセット項目          | `BrowserSongAssetEntry`                                | バイト列または遅延読み込みするファイル参照。譜面とは別。                                      |
| resource / リソース                 | `#WAV`, `#BMP`, `sound_channels`                       | 譜面・スキンが参照する対象。アセット項目がその実体を供給する。                                |
| chart identity / 譜面の同一性       | `chartFingerprint`, `playFingerprint`, `sha256`, `md5` | 譜面・選択分岐・ファイルの識別を分ける。演奏結果の ID とは別。                                |

## プレイ・判定・記録

| 概念                                                | 現行のコード名                                                             | 意味・区別                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| play / プレイ                                       | `manualPlay`, `autoPlay`                                                   | 1 回の実行。単体プレイ・コースステージ・コース全体を明示する。                             |
| play result / プレイ結果                            | `PlayResult`, `PlayerSummary`                                              | 画面向けの結果とエンジンの集計。関連するが同じ型・役割ではない。                           |
| score / 得点                                        | `ScoreSummary.score`, `exScore`, `ScoreSummary`                            | 表示得点・EX-SCORE・判定集計を分ける。表示得点はルールセットに依存する。                   |
| play submission / プレイ送信記録                    | `score`, `submissionId` in Leaderboard                                     | score テーブルは数値ではなく送信済みプレイを保持する。送信 ID とプレイ ID の役割を分ける。 |
| ruleset result / ルールセット別結果                 | `scoreResult`, `PlaylogRulesetResult`                                      | 1 つのルールセットでの評価。実際に遊んだ規則と再シミュレーションを区別する。               |
| best record / 自己ベスト                            | `BestRecord`, `bestScore`, `BeMusicSongRecord`                             | 複数プレイから項目ごとに保持する最良値。単一のベストプレイではない。                       |
| play log / プレイログ                               | `BeMusicPlaylog`, `recordPlaylog`, `serializePlaylog`                      | 再現用の入力記録。含まれる結果キャッシュは再計算できる。                                   |
| judgment / 判定                                     | `JudgeKind`, `Judge`, `JudgeTiming`, `PlaylogJudgeCounts`                  | 判定の種類・時刻付き判定・判定数を区別する。Judge の一括置換では整理できない。             |
| ruleset / ルールセット                              | `BeMusicPlaylog`, `recordPlaylog`, `parsePlaylog`, `serializePlaylog`      | `BeMusicPlayLog`, `recordPlayLog`, `parsePlayLog`, `serializePlayLog`                      | 語の境界を明示する。ローカル変数は `log` とできる。 |
| `PlaylogRulesetId`, `judgeRuleset`, `playedRuleset` | プレイログ専用ではなくプレイ全体の規則。playedRuleset は実際に遊んだ規則。 |
| gauge / ゲージ                                      | `GaugeType`, `gaugeType`, `gauge`, `cleared`, `lamp`                       | 選択した方式・規則上のゲージ・残量・クリア判定・クリアランプを分ける。                     |
| arrangement / レーン配置                            | `randomLane`, `laneOption`, `randomDraws`                                  | レーンのランダム化と BMS 制御構文の分岐抽選を区別する。                                    |
| tempo / テンポ                                      | `speed`, `PlayerTempoChange`, `hiSpeed`, `hsFix`                           | 再生テンポ・表示スクロール速度・その補正を区別する。                                       |
| judgment rank / 判定ランク                          | `judgeRank`, `rank`, `exRank`, `RulesetJudgeRankFacts`                     | 判定幅の厳しさ。ランキング順位や DJ RANK とは別。                                          |
| DJ Rank / DJ RANK                                   | `IIDXRankLabel`, `resolveIIDXRankLabel`                                    | EX-SCORE 率による評価。grade というコース種別とは別。                                      |
| chart level and difficulty / 譜面レベルと難易度区分 | `playLevel`, `difficulty`, `difficultyFilter`                              | 作者が設定したレベルの値と BEGINNER〜INSANE の区分を分ける。                               |

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

## 改名候補（未実装）

読みやすさを優先し、識別子は `playLog` / `PlayLog`、文脈が明確なローカル変数は `log` とする方針です。下の候補は公開名・保存データの改名をまだ実施していません。

| 現行名                                                      | 候補名                                                                     | 理由・注意点                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `PlayResult.song`, `PlayResultFacts.song`                   | `chart`                                                                    | 譜面項目。コース結果では代表として最初のステージを渡すため、その扱いも明示する。 |
| `BrowserSongCollection`, `BrowserSongCollectionStore`       | `BrowserChartCollection`, `BrowserChartCollectionStore`                    | 楽曲作品ではなく譜面を読み込んだ集合。                                           |
| `BrowserSongAssetSource`, `BrowserSongAssetEntry`           | `BrowserAssetSource`, `BrowserAssetEntry`                                  | 複数の譜面で共有する実体。楽曲単位ではない。                                     |
| `BeMusicSongRecord`, `songRecord`                           | `BeMusicChartBestRecord`, `chartBestRecord`                                | 譜面単位であることと、自己ベストの集計であることを明示する。                     |
| `songRecordKey`, `parseSongRecords`, `serializeSongRecords` | `chartBestRecordKey`, `parseChartBestRecords`, `serializeChartBestRecords` | 内容を明示する。保存キー・保存形式の互換性は別途確認する。                       |
| `JudgeKind`, `JudgeTiming`, `PlaylogJudgeCounts`            | `JudgmentKind`, `JudgmentTiming`, `PlayLogJudgmentCounts`                  | 型名を揃える。フォーマットのキーを機械的に変えない。                             |
| `PlaylogRulesetId`                                          | `RulesetId`                                                                | 記録形式ではなくルールセット層の概念。                                           |

`score` テーブルのように保存形式・API と結びつく名前は、この表を理由にそのまま改名しません。新しい内部名には `playSubmission`・`rulesetResult`・`chartBestRecord` のように対象を明示し、境界で既存名に対応付ける案です。`PlayOptions` と `PlayerOptions` は単なる別名ではないため、改名より先に責務を整理します。

`BeMusicStage` は現行名を維持します。`BeMusicSkin.stage` という文脈で、スキンのデザイン領域を指すことが分かるためです。コースステージとの違いは定義で明示します。

## 確認したコード

- [packages/scene-model/src/library/entries.ts](../packages/scene-model/src/library/entries.ts)
- [packages/scene-model/src/play-result/result.ts](../packages/scene-model/src/play-result/result.ts)
- [packages/player-web/src/collection/types.ts](../packages/player-web/src/collection/types.ts)
- [packages/player/src/course/definition.ts](../packages/player/src/course/definition.ts)
- [packages/player/src/ruleset/score.ts](../packages/player/src/ruleset/score.ts)
- [packages/player/src/records/best-record.ts](../packages/player/src/records/best-record.ts)
- [packages/player/src/playlog/format.ts](../packages/player/src/playlog/format.ts)
- [packages/skin-sdk/src/song.ts](../packages/skin-sdk/src/song.ts)
- [packages/skin-sdk/src/types.ts](../packages/skin-sdk/src/types.ts)
- [packages/leaderboard-api/src/db/schema.ts](../packages/leaderboard-api/src/db/schema.ts)
- [packages/accounts/src/schema.ts](../packages/accounts/src/schema.ts)
- [packages/auth-client/src/index.ts](../packages/auth-client/src/index.ts)
- [packages/chart/src/play-modes.ts](../packages/chart/src/play-modes.ts)
