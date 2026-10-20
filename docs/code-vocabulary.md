[Japanese version](./code-vocabulary.ja.md)

# Code domain vocabulary review

This review maps code vocabulary to domain concepts and separates aliases from genuine differences in meaning. Rename candidates below are proposals, not implemented API changes. Read them with the [glossary](./glossary.md).

## Charts and assets

| Concept                             | Current code                                           | Meaning and distinction                                                                                                |
| ----------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| chart / 譜面                        | `BeMusicJSON`, `ResolvedChart`, `LibraryChart`         | Source document, resolved playback data, and library entry are different representations of a chart.                   |
| music / 楽曲                        | `metadata.title`, `metadata.artist`                    | Descriptive metadata is not a unique music ID.                                                                         |
| chart set / 譜面セット              | `chartset`                                             | An externally identified grouping of charts, including add-ons; not a synonym for a chart or its containing directory. |
| chart file / 譜面ファイル           | `chartPath`, `fileSha256`, `fileMd5`                   | File location and raw-byte identity, not chart fingerprint.                                                            |
| chart collection / 譜面コレクション | `BrowserSongCollection`, `BrowserSongCollectionStore`  | Loaded charts, asset sources, errors and course folders; legacy Song names refer to charts.                            |
| asset source / アセット供給元       | `BrowserSongAssetSource`, `sourceId`                   | A bundle of file payloads, potentially shared by several charts.                                                       |
| asset entry / アセット項目          | `BrowserSongAssetEntry`                                | Bytes or a deferred file reference, not a playable chart.                                                              |
| resource / リソース                 | `#WAV`, `#BMP`, `sound_channels`                       | A chart or skin references a resource; an asset entry supplies its payload.                                            |
| chart identity / 譜面の同一性       | `chartFingerprint`, `playFingerprint`, `sha256`, `md5` | Keep chart, selected branch, and raw-file identities distinct; none is a performance ID.                               |

## Play, judgment and records

| Concept                                             | Current code                                              | Meaning and distinction                                                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| play / プレイ                                       | `manualPlay`, `autoPlay`                                  | An execution; qualify single play, course stage or course run.                                                                                  |
| play result / プレイ結果                            | `PlayResult`, `PlayerSummary`                             | Scene-facing result payload versus engine summary; related but not interchangeable.                                                             |
| score / 得点                                        | `ScoreSummary.score`, `exScore`, `ScoreSummary`           | Displayed numeric score, EX-SCORE and judgment summary must be named separately. The displayed score depends on the ruleset.                    |
| play submission / プレイ送信記録                    | `score`, `submissionId` in Leaderboard                    | The score table stores a submitted play, not just one numeric score. Submission and play IDs have separate roles.                               |
| ruleset result / ルールセット別結果                 | `scoreResult`, `PlaylogRulesetResult`                     | Evaluation under one ruleset; distinguish the ruleset actually played from a re-simulation.                                                     |
| best record / 自己ベスト                            | `BestRecord`, `bestScore`, `BeMusicSongRecord`            | Independent per-metric bests across plays; not one winning play.                                                                                |
| play log / プレイログ                               | `BeMusicPlaylog`, `recordPlaylog`, `serializePlaylog`     | Recorded replay input; cached results may be regenerated.                                                                                       |
| judgment / 判定                                     | `JudgeKind`, `Judge`, `JudgeTiming`, `PlaylogJudgeCounts` | A judgment kind, a timed judgment and its counts are separate concepts. Existing Judge names need a coordinated rename, not blind substitution. |
| ruleset / ルールセット                              | `PlaylogRulesetId`, `judgeRuleset`, `playedRuleset`       | The rules belong to playback, not just to play logs. playedRuleset identifies the original play.                                                |
| gauge / ゲージ                                      | `GaugeType`, `gaugeType`, `gauge`, `cleared`, `lamp`      | User-selected gauge, ruleset gauge, remaining value, clear verdict and clear lamp differ.                                                       |
| arrangement / レーン配置                            | `randomLane`, `laneOption`, `randomDraws`                 | Lane randomization differs from BMS control-flow branch selection.                                                                              |
| tempo / テンポ                                      | `speed`, `PlayerTempoChange`, `hiSpeed`, `hsFix`          | Playback tempo differs from visual scroll speed and its normalization.                                                                          |
| judgment rank / 判定ランク                          | `judgeRank`, `rank`, `exRank`, `RulesetJudgeRankFacts`    | Timing strictness from chart metadata; not a leaderboard position or DJ Rank.                                                                   |
| DJ Rank / DJ RANK                                   | `IIDXRankLabel`, `resolveIIDXRankLabel`                   | Performance grade derived from EX-SCORE rate; not the course kind named grade.                                                                  |
| chart level and difficulty / 譜面レベルと難易度区分 | `playLevel`, `difficulty`, `difficultyFilter`             | Authored numeric/string level differs from BEGINNER through INSANE categories.                                                                  |

## Courses and layouts

| Concept                                     | Current code                                                    | Meaning and distinction                                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| course / コース                             | `CourseDefinition`, `RandomCourseDefinition`, `LibraryCourse`   | Fixed definition, drawing recipe and library presentation are separate.                                                                       |
| course stage / コースステージ               | `CourseStageRef`, `LibraryCourseStage`, `stage`                 | A stage reference may resolve to a library chart; it is not a canvas.                                                                         |
| course run / コースプレイ                   | `CourseRun`, `courseRun`, `PlayRunKind`                         | One execution of a course. NONSTOP is one stitched play rather than sequential engine plays.                                                  |
| design stage / デザイン領域                 | `BeMusicStage`, `portraitStage`                                 | The design canvas dimensions and BGA placement, not a course stage.                                                                           |
| play variant / キー構成                     | `ChartPlayVariant`                                              | Broad key-count category; distinguish it from channel layout.                                                                                 |
| play-mode layout / プレイモードのレイアウト | `PlayModeLayoutId`, `PlayModeLayout`, `PlayLane`                | Actual lane/channel mapping; one variant can have multiple layouts.                                                                           |
| course kind / コース種別                    | `CourseKind`, `RulesetCourseKind`, `grade`, `expert`, `nonstop` | grade denotes dan certification; CLASS can be an external gauge or constraint name. Do not replace those external spellings indiscriminately. |

## Library and presentation

| Concept                     | Current code                                         | Meaning and distinction                                                                                                  |
| --------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| library / ライブラリ        | `Library`, `LibraryChart`, `LibraryEntry`            | Browsable collection, chart entry and list item; list items can also be folders or courses.                              |
| browse state / ブラウズ状態 | `BrowseState`, `BrowseSnapshot`                      | Navigation/filter state versus a snapshot used for restoration.                                                          |
| play options / プレイ設定   | `PlayOptions`, `PlayerOptions`, `PlayerPlaySettings` | Selection UI choices, engine execution configuration and recorded play settings differ. Do not merge them by name alone. |
| scene / シーン              | `SessionScene`, `PixiSceneHost`, `SceneFamily`       | A screen execution, its host and the skin family are separate roles.                                                     |
| scene model / シーンモデル  | `BrowseState`, `PlayState`, `PlayResult`             | State/data independent of a particular renderer; not the scene controller itself.                                        |
| skin / スキン               | `BeMusicSkin`, LR2 and beatoraja skins               | Appearance implementation; a theme can bundle multiple skins and sounds.                                                 |
| frame / フレーム            | `BeMusicGameplayFrame`, `BeMusicAudioFrame`          | Qualify scene frame or audio frame; they are different data and clocks.                                                  |

## Identity and authentication

| Concept                                 | Current code                                            | Meaning and distinction                                                                                  |
| --------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| identity / 認証上の同一性               | `Identity.issuer`, `Identity.sub`, `userId`             | OIDC issuer plus subject identifies an external identity; the local user ID is its service-side mapping. |
| linked login account / 外部ログイン連携 | `account`, `accountId`, `providerId` in Accounts schema | Provider association; not another be-music user or a Cloudflare account.                                 |
| profile / プロフィール                  | `profile`, `handle`, `displayName`, `avatarKey`         | Public presentation owned by a user; profile changes do not change identity.                             |
| authentication session / 認証セッション | `LoginSession`, Better Auth session                     | App login state differs from Accounts state, scene sessions and audio sessions.                          |
| guest / ゲスト                          | `isAnonymous`, `Identity.anonymous`, `linkedGuests`     | Credential-free identity and its migration links; do not infer missing user identity.                    |

## Rename candidates (not implemented)

| Current names                                               | Candidate names                                                            | Reason and constraint                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `PlayResult.song`, `PlayResultFacts.song`                   | `chart`                                                                    | A chart entry, including a representative first-stage chart for a course result; review that case explicitly. |
| `BrowserSongCollection`, `BrowserSongCollectionStore`       | `BrowserChartCollection`, `BrowserChartCollectionStore`                    | Collection of charts rather than musical works.                                                               |
| `BrowserSongAssetSource`, `BrowserSongAssetEntry`           | `BrowserAssetSource`, `BrowserAssetEntry`                                  | Shared payloads, not one song per source.                                                                     |
| `BeMusicSongRecord`, `songRecord`                           | `BeMusicChartBestRecord`, `chartBestRecord`                                | Make both chart granularity and aggregated bests explicit.                                                    |
| `songRecordKey`, `parseSongRecords`, `serializeSongRecords` | `chartBestRecordKey`, `parseChartBestRecords`, `serializeChartBestRecords` | Names describe the data. Storage keys and formats require a separate compatibility review.                    |
| `JudgeKind`, `JudgeTiming`, `PlaylogJudgeCounts`            | `JudgmentKind`, `JudgmentTiming`, `PlaylogJudgmentCounts`                  | Coordinated type-name cleanup; do not rename format keys mechanically.                                        |
| `PlaylogRulesetId`                                          | `RulesetId`                                                                | The concept belongs to the ruleset layer, not the recording format.                                           |
| `BeMusicStage`                                              | `BeMusicDesignStage`                                                       | Disambiguate design coordinates from course stages.                                                           |

Names tied to storage or API contracts, such as the score table, must not be renamed solely because of this table. Prefer explicit new internal names such as `playSubmission`, `rulesetResult` and `chartBestRecord`, mapping to existing names at boundaries. `PlayOptions` and `PlayerOptions` are not synonyms: clarify their responsibilities before renaming them.

## Inspected code

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
