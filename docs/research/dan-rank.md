[日本語](./dan-rank.ja.md)

# Player dan rank

Investigated 2026-11-02 for #552 (a follow-up of #373). The question: how do LR2 and beatoraja turn a GRADE (class) course clear into the player's dan rank, and where do skins show it? The answer decides what be-music keeps and shows. See [Courses and dan certification](../course.md#the-players-dan-rank) for what be-music does.

Sources read: OpenLR2 at [`583a385`](https://github.com/GOMazk/OpenLR2/tree/583a38503555e59c4bafa49d60b9d0714c9007c2) (a decompilation of `LR2body.exe`) and beatoraja [0.8.9](https://github.com/exch-bms2/beatoraja/tree/0.8.9). OpenLR2 is a decompilation, so "OpenLR2 never does X" means the converted code never does it. The binary itself was not run.

## Summary

- **LR2** keeps one dan value per key mode in its player table (`grade_7`, `grade_5`, `grade_14`, `grade_10`, `grade_9`). It reads and saves them, but no code in OpenLR2 ever sets them from a course result, and no skin number, text or image reads them. They are leftovers of an older built-in dan certification and are wiped whenever `gradeversion` is not 0.
- **beatoraja 0.8.9** keeps no dan rank of its own. `PlayerInformation.rank` (段位) is a free-form string an Internet Ranking server sends for a rival. No skin property shows it, and a course clear never writes it. `CourseData.isClassCourse()` exists but nothing calls it.
- Neither player maps a course to a dan. A course is a dan course only by kind (LR2 `type` 2, beatoraja's `grade` / `grade_mirror` / `grade_random` constraints). The dan a course stands for is only in its name (`七段`, `発狂皆伝`, …).

So the mapping from a course to a dan and the order of the dans are be-music's own design. Nothing in either player can be matched for them.

## LR2 (OpenLR2)

### Where the dan is stored

The score database's `player` table has one integer column per key mode ([LR2f.cpp L19212](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L19212)):

```sql
CREATE TABLE player(..., grade_7 INTEGER, grade_5 INTEGER, grade_14 INTEGER, grade_10 INTEGER, grade_9 INTEGER,
  trial INTEGER, option INTEGER, systemversion INTEGER, gradeversion INTEGER, trialversion INTEGER, scorehash TEXT)
```

`PLAYERSTATISTIC` holds them as `grade7`, `grade5`, `grade14`, `grade10` and `grade9`, next to `gradeversion` ([structure.h L1348-L1374](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/structure.h#L1348-L1374)). So LR2 keeps **one dan per key mode**: 7 keys, 5 keys, 14 keys (DP), 10 keys (DP) and 9 keys (PMS).

### How it is read and written

- `ReadPlayerScore` reads the five columns at login ([L18318-L18322](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L18318-L18322)). If the row's `scorehash` does not match, every statistic is reset, the dans included ([L18337-L18359](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L18337-L18359)). If `gradeversion` is not 0, the five dans are reset and `gradeversion` set to 0, with the log message 「段位認定が更新されたのでデータを初期化しました」 ([L18361-L18374](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L18361-L18374)).
- `MakePlayerStatHash` hashes them into `scorehash`, and `UpdatePlayerStat` writes them back unchanged ([L16969-L16984](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L16969-L16984)).
- Nothing else touches them. The only assignments are the resets above. The course result (`ProcS_CourseResult` → `CheckCourseClear` → `ProcS_subCourseResult`, [L9592-L9760](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L9592-L9760)) updates the course's own best record, the play count and the clear and fail counts, then calls `UpdatePlayerStat`. It never sets a dan, whatever the course type.

### Skins

`SetObjectValue_Num` exposes the player statistics as numbers 30-41: play count, clears, fails, judgments, combo, max combo and the trial level ([L496-L519](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L496-L519)). None of them reads a `grade` field. The course ops are about the course under the cursor or being played (images 291-293 for its kind, numbers 250-259, texts 150-170, see [LR2 skins](../lr2-skin.md)), not the player's dan. The "trial" (numbers 40/41, texts 82/83) is LR2's mission ladder (`CheckMission`), not a dan.

**Unverified:** whether the binary writes `grade_*` in code OpenLR2 has not converted. Its function list marks 451 functions converted and 11 skipped (hashing, MD5 and time helpers), and none of the skipped ones touches player statistics. The `gradeversion` reset suggests an older LR2 build once certified dans itself. That build was not examined.

## beatoraja 0.8.9

- `PlayerInformation` has `id`, `name` and `rank` (commented 段位) ([PlayerInformation.java L8-L25](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/PlayerInformation.java#L8-L25)). It is stored in the score database's `info` table (`rank TEXT`, [ScoreDatabaseAccessor.java L31-L36](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/ScoreDatabaseAccessor.java#L31-L36), [L108-L127](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/ScoreDatabaseAccessor.java#L108-L127)).
- The only writer is a rival read from an IR server: `RivalDataAccessor.createRival` copies `IRPlayerData.rank` ([RivalDataAccessor.java L143-L149](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/RivalDataAccessor.java#L143-L149), [IRPlayerData.java](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/ir/IRPlayerData.java)). The IR server decides what the string says. beatoraja never derives it.
- No skin property reads it. String 1 is the rival's name and string 2 the player's name ([SkinProperty.java L214-L215](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/skin/SkinProperty.java#L214-L215), [StringPropertyFactory.java L174-L183](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/skin/property/StringPropertyFactory.java#L174-L183)). The Lua `main_state` API has no rank either.
- A course result writes the course's score under its stage hashes, long-note mode and constraints, like any score ([CourseResult.java L272](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/result/CourseResult.java#L272)). It sets no dan.
- `CourseData.isClassCourse()` says whether a course has a `CLASS` / `MIRROR` / `RANDOM` constraint ([CourseData.java L84-L91](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/CourseData.java#L84-L91)). Nothing in 0.8.9 calls it. Skins tell a dan course apart by the constraint options 1002-1004 (`OPTION_GRADEBAR_CLASS` …).

## What this means for be-music

| Question                       | LR2                             | beatoraja 0.8.9                       | be-music                                                                                                      |
| ------------------------------ | ------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Is a dan kept?                 | Columns per key mode, never set | Only an IR-supplied string for rivals | Highest cleared dan per judge ruleset and key mode                                                            |
| Which course counts?           | —                               | —                                     | A cleared GRADE course run that keeps a best record                                                           |
| Which dan does a course grant? | —                               | —                                     | Read from the course name (`resolveCourseDanRank`); unverified against either player                          |
| How are dans ordered?          | —                               | —                                     | be-music's ladder: 十級 … 一級, 初段 … 十段, 中伝, 皆伝, 発狂初段 … 発狂十段, 発狂皆伝, Overjoy (`DAN_RANKS`) |
| Which skin shows it?           | No op                           | No property                           | be-music skins' `frame.danRanks`; the built-in Plain skin's select header                                     |

The per-key-mode split follows LR2's columns. Keeping one rank per judge ruleset follows how be-music keeps best records. Because neither player shows a dan, no LR2 op or beatoraja property is added. A theme that wants one would need an extension, which is left open.
