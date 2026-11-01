[Japanese version](./course.ja.md)

# Courses and dan certification

A **course** chains several charts into one run. The best-known kind is **dan certification (段位認定)**: the stages are played back to back on one shared class gauge, and the whole run gets a single result. LR2 and beatoraja each define courses in their own formats, and difficulty tables publish theirs inside the table header. be-music reads all three into one model, `CourseDefinition` in `@be-music/player-engine/course`, so nothing downstream needs to know where a course came from.

This document defines the course model, format mappings, play rules, records and replays. See the [browser player specification](./player-web.md#courses-and-dan-certification) for scene transitions.

```mermaid
flowchart LR
  lr2[".lr2crs<br/>(LR2, XML)"] -->|parseLR2CourseFile| def["CourseDefinition"]
  bjson["course/*.json<br/>(beatoraja)"] -->|parseBeatorajaCourseFile| def
  table["table header.json<br/>course / grade"] -->|parseTableHeaderCourses| def
  def -->|"resolveCourseStages<br/>(by SHA-256, then MD5)"| resolved["ResolvedCourse<br/>stages + playable"]
```

## The course model

| Field         | Meaning                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | Course title.                                                                                                                                                                                |
| `kind`        | `grade` (dan certification), `expert` (chained stages on the player's gauge) or `nonstop` (stages stitched into one continuous play).                                                        |
| `stages`      | The charts in order, each by chart-file `md5` and / or `sha256` (lower-case hex), with an optional `title` and `artist` to show for a chart that is not found locally.                       |
| `constraints` | beatoraja's course constraints by their table-header name (below). Unknown names are dropped and only the first constraint of each group is kept, as beatoraja's `CourseData.validate` does. |
| `trophies`    | beatoraja trophies, easiest first: `{ name, missRate, scoreRate }`. A result earns the last trophy whose BP rate is at most `missRate` % and whose score rate is at least `scoreRate` %.     |
| `release`     | beatoraja's `release`. `false` keeps the course's scores off any ranking.                                                                                                                    |
| `keyMode`     | The key mode the course is meant for, when the source says (LR2 `line`, table `mode`).                                                                                                       |
| `source`      | Which format the course came from, with the raw LR2 hash for `.lr2crs`.                                                                                                                      |

### Constraints

| Name                                                             | beatoraja enum               | Group    | Meaning                                            |
| ---------------------------------------------------------------- | ---------------------------- | -------- | -------------------------------------------------- |
| `grade`                                                          | `CLASS`                      | option   | Dan course; no lane option.                        |
| `grade_mirror`                                                   | `MIRROR`                     | option   | Dan course; MIRROR allowed.                        |
| `grade_random`                                                   | `RANDOM`                     | option   | Dan course; random options allowed.                |
| `no_speed`                                                       | `NO_SPEED`                   | speed    | No hi-speed (or lane cover, lift, HIDDEN) change.  |
| `no_good`                                                        | `NO_GOOD`                    | judge    | No GOOD window.                                    |
| `no_great`                                                       | `NO_GREAT`                   | judge    | No GREAT or GOOD window.                           |
| `gauge_lr2` / `gauge_5k` / `gauge_7k` / `gauge_9k` / `gauge_24k` | `GAUGE_LR2` … `GAUGE_24KEYS` | gauge    | Which class-gauge table set the course uses.       |
| `ln` / `cn` / `hcn`                                              | `LN` / `CN` / `HCN`          | longNote | Long-note mode for charts that leave it undefined. |

Table headers write the left-hand names; beatoraja's own course files write the enum names. Both are accepted. A course with an option-group constraint is a dan course (`kind: 'grade'`), as beatoraja's `CourseData.isClassCourse` decides.

## Formats

### LR2 `.lr2crs`

An XML `<courselist>` of `<course>` elements with `title`, `line` (key mode), `type` and `hash`. LR2 reads the field names case-sensitively, and so does be-music.

- **Encoding.** A byte-order mark wins, then the XML declaration's `encoding`, then strict UTF-8, then Shift_JIS (`decodeCourseText`).
- **`hash`.** A 32-character header followed by one 32-character chart MD5 per stage. A course bar lists up to ten stages, but LR2 plays only the first five of any course, EXPERT and GRADE included (its chart loader clamps the stage count to 1-5 on every play, `LR2body.exe` 0x4b0b0f), so a course is read as those five. `countLR2UnplayedStages(course)` counts the stages left out, which the web player reports when a file is loaded. Character 10 of the header is the course type.
- **`type`.** `0` EXPERT, `1` NONSTOP, `2` GRADE, following OpenLR2 (its `expert` / `nonstop` / `grade` tables and skin ops 291-293). Without a `type` element the header's character 10 is used.
- **Constraints.** The format has none. A grade course gets `grade` and `gauge_lr2`: when a GRADE course starts, LR2 turns both sides' lane options off ([Main.cpp M1124-M1170](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/Main.cpp#L1124-L1170)), so only OFF is allowed. A table's legacy `grade` list keeps jbmstable-parser's `grade_mirror`.
- **LR2's other resets.** The same code also moves an EASY or G-ATTACK gauge pick to GROOVE and turns off HIDDEN / SUDDEN, the assists (auto scratch and the rest), BATTLE, DP FLIP, the play tempo (pitch) and the extra modifiers. LR2 writes them into its config; a host applies them to the course's stages only, so the player's settings come back afterwards (`isLR2GradeCourse`, `resolveLR2GradeCoursePlaySettings` in `@be-music/player-engine/course`). They apply to a GRADE course read from `.lr2crs` or made with the course maker, not to a table's or beatoraja's grade.
- A course with no stage, a malformed stage hash or an unknown type is skipped.

### beatoraja `course/*.json`

An array of `CourseData` objects, or a single object (beatoraja's fallback read). Each has `name`, `hash` (stages with `md5` and / or `sha256` and a `title`), `constraint`, `trophy` and `release`.

- A missing name becomes `No Course Title`, and a stage without a title becomes `course N`.
- A course with no stage, or with a stage that has neither hash, is skipped, as `CourseData.validate` does.
- `kind` is `grade` with an option-group constraint and `expert` otherwise.

beatoraja's **random courses** (`RandomCourseData`) draw each stage from the charts an SQL `WHERE` clause selects in its song database. `parseBeatorajaRandomCourseData` reads `name`, `stage[].sql` (kept as `filter`), `constraint`, `rconstraint` (`distinct`) and `trophy`; drawing the charts is the host's job.

### Difficulty-table headers

The table header (`header.json`) carries courses the way jbmstable-parser reads them:

- `course` as an array of groups (`Course[][]`), each group a folder of courses;
- `course` as one group (`Course[]`);
- otherwise the legacy `grade` list. Its courses all get `grade_mirror` and `gauge_lr2`.

A course takes its stages from `charts` (full table elements, which may carry `sha256`) or from `md5`. One whose charts lack a hash is skipped, and a stage without a title becomes `course N`, as beatoraja's `CourseData.validate` names it. The header's `mode` (`beat-7k`, `popn-9k`, …) sets `keyMode`.

#### Loading a table from its URL

A difficulty table is usually shared as the URL of its HTML page, which names the header in `<meta name="bmstable" content="header.json">`. `fetchTableHeaderCourses(url, fetchText)` loads the courses from that page URL or from the header JSON URL itself:

```mermaid
flowchart TD
  url["table URL"] -->|fetchText| body["response body"]
  body -->|JSON object| header["header.json"]
  body -->|HTML| meta["resolveTableHeaderURL<br/>(bmstable meta)"]
  meta -->|fetchText| header
  header -->|parseTableHeaderCourses| result["label + courses"]
```

- `resolveTableHeaderURL(pageURL, html)` finds the `bmstable` meta (attribute order, quoting and case do not matter) and resolves its `content` against the page URL. It gives `undefined` when the page has none.
- The label is the header's `name`, else its `symbol`, else the host of the URL. The course groups are flattened into one list.
- Only the header is fetched. The song list behind `data_url` is not read.
- The caller passes `fetchText`, so the module stays runtime-neutral: a browser host wraps `fetch`, a CLI can read from disk or the network. Fetch errors propagate; a page without a header, or a header that is not a JSON object, throws.

### beatoraja random courses

beatoraja's command-folder file (`folder/default.json`, `BarManager.CommandFolder`) can hold **random courses** (`rcourse`, [`RandomCourseData`](https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/select/RandomCourseData.java)). Each stage is an SQL `WHERE` clause over the song database instead of a chart, and the stages are drawn when the course starts. `parseBeatorajaCommandFolderFile` reads them into `RandomCourseDefinition`s, one group per folder that has any.

```mermaid
flowchart LR
  file["folder/default.json"] -->|parseBeatorajaCommandFolderFile| rdef["RandomCourseDefinition"]
  rdef -->|"drawRandomCourse(definition, songs, random)"| def["CourseDefinition"]
  def --> play["played like any course"]
```

- **Filters.** be-music has no song database, so `parseCourseChartFilter` / `evaluateCourseChartFilter` read the clause and test each chart (`CourseChartRecord`) with SQLite's comparison rules. The subset covers comparisons, `AND` / `OR` / `NOT`, `IN`, `LIKE`, `BETWEEN`, `IS NULL` and arithmetic over the columns listed under [Filter columns](#filter-columns). beatoraja joins `song` with the player's `score` and `scorelog` and with `information`, so a column more than one of them has must be qualified: an unqualified `sha256`, `mode`, `notes`, `date`, `clear`, `combo`, `minbp` or `avgjudge` is ambiguous to SQLite, and the filter is refused (write `song.mode = 7`, not `mode = 7`). A column only one table has can go unqualified (`playcount`, `density`). A trailing `ORDER BY` (expressions or `RANDOM()`, `ASC` / `DESC`, `NULLS FIRST` / `LAST`) and `LIMIT n [OFFSET m]` / `LIMIT m, n` cut the selection before the draw, as beatoraja's own `folder/default.json` does for MY BEST (`playcount > 0 ORDER BY playcount DESC LIMIT 10`); `selectCourseCharts` applies them, ties keep the candidates' order, and `RANDOM()` reads the injected `random`. Anything else (an unknown column, a column be-music has no source for, a function, a sub-query) is a parse error, and the stage selects no chart, as beatoraja's failing query returns none. The select screen's search runs the same filters: a search that starts with `?` is one ([scene-model.md](scene-model.md#browse)).
- **Drawing.** `drawRandomCourse(definition, candidates, random)` follows `RandomCourseData.lotterySongDatas`. Each stage draws uniformly from what its filter selects (after its `ORDER BY` / `LIMIT`); a stage without a filter draws from the previous stage's selection (every chart for the first). With `distinct`, a chart already drawn is drawn again, unless every candidate is taken. The result is a fixed course: `grade` when the definition has a lane-option constraint, else `expert`. `random` is injected, so a draw is reproducible.
- **Failure.** A stage whose filter does not parse, or selects nothing, stops the draw and is reported (`RandomCourseDrawFailure`).
- **Kept draws.** Once the decide screen opens (or direct play loads), the web host appends the fixed draw to its source folder, named `<name> yyyyMMdd_HHmmss` in local time and with `release: false`. PLAY and AUTO both keep draws. The cursor returns to the new bar, and starting it again plays the same stages without another draw. The host keeps at most 100 draws across all folders, oldest first, and drops the oldest on overflow. This history lasts only for the session; records and replays still use the course's stage identity.

### Filter columns

A filter reads three of beatoraja's tables (`SQLiteSongDatabaseAccessor.getSongDatas`, [beatoraja 83574048](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/song/SQLiteSongDatabaseAccessor.java#L344-L367)). Each column comes from what be-music knows of the chart; a column it has no source for is refused as an unknown column rather than read as a made-up value.

- **`song`** is the chart itself: `md5`, `sha256`, `title`, `subtitle`, `artist`, `subartist`, `genre`, `tag`, `path`, `level`, `difficulty`, `mode`, `notes`, `minbpm`, `maxbpm`, `length`, `judge`, `feature` and `content`. A missing text column reads as `''` and a missing number as 0, as beatoraja's `SongData` stores them.
- **`score`** is the player's best record on the chart under the active judge ruleset (Developer → Judgment windows), the record the select screen shows (`createCourseChartScore`). beatoraja joins it with `LEFT OUTER JOIN`, so a chart never played has every `score` column NULL: `score.clear < 5` skips it, `score.clear IS NULL OR score.clear < 5` takes it.
- **`information`** is the chart's song information (`SongInformation`), worked out from the chart the first time a filter reads it.

| Column                                             | be-music source                                                                                                                                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `score.clear`                                      | The best lamp as beatoraja's `ClearType` (`beatorajaClearType`): NO PLAY 0, FAILED 1, ASSIST EASY 3 (beatoraja's LIGHT ASSIST EASY), EASY 4, NORMAL 5, HARD 6, EX HARD 7, FULL COMBO 8, PERFECT 9, MAX 10 |
| `score.exscore`                                    | The best EX score. be-music's own column: beatoraja keeps the judgment counts instead                                                                                                                     |
| `score.combo`                                      | The best max combo                                                                                                                                                                                        |
| `score.minbp`                                      | The fewest BP                                                                                                                                                                                             |
| `score.playcount`                                  | The plays the record counts                                                                                                                                                                               |
| `score.notes`                                      | The chart's note count                                                                                                                                                                                    |
| `score.sha256`                                     | The chart's SHA-256, on a chart with a record                                                                                                                                                             |
| `information.n` / `ln`                             | Taps / long notes on the keys; a CN or HCN counts its end too, as `BMSModelUtils.getTotalNotes` does                                                                                                      |
| `information.s` / `ls`                             | The same on the scratch                                                                                                                                                                                   |
| `information.total`                                | The TOTAL as beatoraja plays it: `#TOTAL`, a bmson `total` as a percentage of the default, else beatoraja's default for the note count (`BMSPlayerRule.validate`)                                         |
| `information.density`, `peakdensity`, `enddensity` | The average, busiest-second and end densities (`computeBeatorajaChartDensityValues`, after `SongInformation`)                                                                                             |
| `information.mainbpm`                              | The BPM the most judged notes sit at (`resolveChartMainBPM`)                                                                                                                                              |
| `information.sha256`                               | The chart's SHA-256                                                                                                                                                                                       |

No source, so refused: `song.folder`, `stagefile`, `banner`, `backbmp`, `preview`, `parent`, `date`, `favorite`, `adddate` and `charthash`; `score.mode`, the judgment counts (`epg`, `lpg`, `egr`, `lgr`, `egd`, `lgd`, `ebd`, `lbd`, `epr`, `lpr`, `ems`, `lms`), `avgjudge`, `clearcount`, `trophy`, `ghost`, `option`, `seed`, `random`, `date`, `state` and `scorehash`; `information.distribution`, `speedchange` and `lanenotes`; and every `scorelog` column, since be-music keeps no log of record updates. The select screen's search does not hash the charts, so there `md5` and `sha256` read as `''`.

## NONSTOP courses

An LR2 NONSTOP course (`.lr2crs` type 1) is not played stage by stage: LR2's chart loader stitches its stages (at most five) into one chart and plays it as a single run ([`ParseBMSFile`](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L25680), `LR2body.exe` 0x4b0690). The LR2-compatible placement accepts BMS stages. The intended placement also accepts bmson stages and mixed courses. This section covers how the stages are placed and stitched; the browser player plays the stitched chart ([player-web.md](player-web.md)).

**Connections.** Each stage but the last has a connection to the next, stored in the first ten characters of the course hash (`courseKeys`, `0`-`5`) and read by `parseLR2NonstopConnections` into `CourseDefinition.connections`:

| Digit | Connection | Placement after it                                             | Sound                      |
| ----- | ---------- | -------------------------------------------------------------- | -------------------------- |
| 0     | `fade`     | next first note within 0.5 measure                             | 10 s fade-out, 5 s fade-in |
| 1     | `fade-fit` | as `fade`, next stage time-stretched to this stage's final BPM | 5 s fade-in                |
| 2     | `cut`      | as `fade`                                                      | 0.2 s cross-cut            |
| 3     | `cut-fit`  | as `cut`, time-stretched                                       | 0.2 s cross-cut            |
| 4     | `blank1`   | within 1.5 measures                                            | 5 s fade-in                |
| 5     | `blank2`   | no cut, after a gap of more than 5 s                           | none                       |

**Placement** (`planNonstopCourse`, with `createNonstopStageTiming` reading a stage chart):

```mermaid
flowchart LR
  last["stage k: last note"] --> line["nearest bar line<br/>(boundary)"]
  line --> start["stage k+1 starts<br/>at the boundary"]
  start --> cut["cut leading measures<br/>until the first note is close"]
  cut --> shift["move earlier by<br/>the measures cut"]
```

- A stage hands over at the bar line nearest its last visible note, the earlier one on a tie ([L26432-L26458](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26432-L26458)). After `blank2`, at the first bar line more than 5 s later.
- The next stage starts at that line. Its leading measures are cut while its first note is 0.5 measure or more past the line (the binary compares `>=`; OpenLR2 reads `>`), more than 1.5 after `blank1`, and not at all after `blank2` ([L26888-L26960](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26888-L26960)). The stage is then moved earlier by the time of the measures cut.
- After a `-fit` connection the stage is time-stretched by the previous stage's final BPM over its `#BPM`; LR2 also changes the keysounds' pitch by that factor.
- The positions LR2 keeps as 32-bit floats are rounded the same way. OpenLR2 truncates the previous stage's last-measure time to an integer; the binary keeps it a float.

**LR2 placement.** `planNonstopCourse(..., { placement: 'lr2' })` follows the binary exactly, including what looks like a bug. LR2 never updates its `lastMeasure` after cutting a stage, so from the third stage on a stage starts at the previous stage's line _before_ that stage was cut: its time origin runs on by the previous cut at its own BPM and measure-0 length, and it is then cut by both. The result matches the intended placement while the tempo and measure lengths stay the same, and moves the stage when its first measures differ (by the previous cut × the difference). This placement also takes the first note as LR2's loader reads it: the first visible note in file order, lowered by any object on a later line. The default `'intended'` placement starts each stage where the previous one was placed and takes the first visible note.

**Stitching** (`stitchNonstopCourse`). The placed stages become one chart that the engine plays as a single chart:

- **Time-based scroll.** LR2 scrolls a NONSTOP play by time, a constant 150-BPM scroll ([L26529](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26529), [L27067](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L27067)). The stitched chart therefore runs at 150 BPM, and each object sits where its own stage's timing (and FIT) puts it, to 1/9600 of a measure (about 0.17 ms).
- **Windows.** Each stage owns the time from the previous boundary to its own. Its bar lines there (from the one nearest its first note) become the stitched measures, and its STOPs there freeze the scroll. Notes, invisible notes, mines, BGM and BGA keep their place wherever they fall.
- **The seam.** A later stage's note that lands more than 0.1 s before the previous stage's last note head, or within 0.1 s of it on a lane an earlier stage also used then, becomes background sound. A long note converted this way keeps only its head's sound ([L26988-L27010](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26988-L27010)).
- **Extended BGA resources.** EXBMP-only filenames and BGA sub-region dependencies keep separate ids per stage, including reused source ids and filenames. `assetPath` rewrites the image paths; sub-region references, coordinates and placement follow their new ids. The stage's `bmpKeys` includes dependency ids. Dependency traversal is iterative and cycle-safe; a dependency that exceeds the BMS key space fails the stitch with `id-space`. Mixed bmson output retains long internal ids. Authored EXBMP color fields are preserved; transparent-color rendering remains a separate compatibility gap.
- **BGA opacity.** Nonzero hexadecimal `0B`–`0E` events keep their placed times in the flattened chart. Each stage window starts with that stage's effective values, including commands in a trimmed leading interval; a stage without commands restores opaque defaults, and a previous stage's tail cannot change the next stage's state. `map.stages[].bgaOpacity` retains independent histories on the stitched clock, including FIT and STOP timing, for hosts that crossfade stage-owned images. The field is omitted when the stage has no opacity commands. Native, Canvas, LR2 and beatoraja browser scenes consume these histories independently for every visible stage, multiplying each plane's opacity by its stage crossfade and skin opacity.
- **Keys.** Every stage's keysound, BGA and STOP keys are renumbered into one base-62 space (`#BASE 62`). BMS output refuses more than 3843 of one kind (`id-space`); output containing bmson stages uses longer IR keys as needed. BMS mines keep their damage value; bmson output carries explicit per-mine damage.
- **Rank and TOTAL.** The stitched chart opens with the first stage's `#RANK` and uses the last stage's `#TOTAL`; LR2 overwrites TOTAL stage by stage. Each later stage's `#RANK` then takes over (`map.stageRanks`, below).
- **Judgment rank of later stages** (`resolveNonstopStageRanks`). LR2's loader turns a later stage's `#RANK` into an object at the stage's start ([L26301-L26313](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26301-L26313)), which moves earlier with the rest of the stage when it is cut, and the play loop sets the judge windows when it gets there ([L12831-L12877](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L12831-L12877), `LR2body.exe` 0x42be2f). With `placement: 'lr2'` the change comes there, at the stage's own time zero, which can be several measures before the previous stage's last notes; a stage without `#RANK` keeps the rank in force; and the windows come from LR2's own NONSTOP table (`resolveLR2NonstopRankWindowsMs`), which differs from the one a chart opens with (0x4b5835) for VERY HARD (PGREAT ±12 / GREAT ±24 / GOOD ±60 ms instead of ±8 / ±24 / ±40) and HARD (GOOD ±80 ms instead of ±60). The default `'intended'` placement switches halfway between the previous stage's last note and the stage's first one, to the windows a chart opening with that `#RANK` gets, and reads a stage without `#RANK` as NORMAL.
- **BPM readout** (`resolveNonstopTempo`, `nonstopBPMAt`). The stitched chart runs at 150 BPM, but LR2 shows each stage's own BPM: its loader inserts a later stage's `#BPM` as a BPM object (× the FIT rate) at the stage's start ([L26257-L26273](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26257-L26273)), and the play loop's BPM object sets the readout ([L12717-L12724](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L12717-L12724)). `map.tempo` holds that readout: by default each stage's BPM over its own window; with `placement: 'lr2'` in LR2's event order (a later stage's `#BPM` from its time zero, and a stage's BPM changes from its last-measure line on dropped, except the last stage's, [L26970-L26976](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26970-L26976)).
- **For the host.** The result's map gives each stage its keys (for its sound bus and BGA layer), its window, the sound fades and the 3 s BGA crossfade the connection calls for, and whether LR2 announces the stage (only after a BLANK connection), plus the BPM readout (`tempo`) and the judge rank changes (`stageRanks`, for the engine's `stageRanks` option, which the replay records as `chart.judgeRank.stageRanks` so a replay and a re-simulation judge with them). `assetPath` lets the host prefix each stage's file paths.
- **Not covered yet.** The scroll of an object of one stage that sounds during another stage's STOP.

**bmson stages.** Under `placement: 'intended'`, any bmson stage makes the output a bmson IR chart, including mixed BMS/bmson courses. LR2 placement refuses bmson. The stitch retains source-audio slice coordinates, continuation flags, long-note modes, hidden keysounds, mine damage and BGA layers. FIT preserves source-audio coordinates; keep-pitch playback converts them into stretched-buffer coordinates. LR2 and beatoraja apply each stage's own judge-rank units (`bmson` for raw `judge_rank`, `chart` for BMS `#RANK`, `bms-exrank` for `#DEFEXRANK`). The last stage's TOTAL retains its absolute or percentage unit. Course fingerprints still use the original stage fingerprints, and the current stitch version is 3 (versions 1 and 2 remain available for earlier replays). See [ADR 0017](./adr/0017-bmson-nonstop.md).

**The pipeline** (`prepareNonstopCourse`, `resolveNonstopRun`, `buildNonstopCourseReplay`). A host stitches a course to play it, and the Leaderboard rebuilds a run's stitched chart to verify it, with the same steps, so the two agree on the chart that was played:

```mermaid
flowchart TD
  charts["stage charts, as loaded"] --> resolve["resolve control flow<br/>(drawn, or the recorded draws)"]
  resolve --> ln["applyCourseLongNoteConstraint"]
  ln --> stitch["stitchNonstopCourse"]
  stitch --> play["play the stitched chart"]
  play --> run["resolveNonstopRun"]
  run --> log["buildNonstopCourseReplay"]
```

- `prepareNonstopCourse(stages, options)` resolves each stage chart's `#RANDOM` / `#SWITCH` (with the stage's `randomDraws` when given, else drawn with `random`), applies the course's long-note constraint, and stitches the stages with the connections, placement and stitching rules. The host's asset plumbing comes in through `assetPath`, which gets the stage charts as played. A stage chart that does not resolve is refused as `stage-chart`.
- `resolveNonstopRun(course, replay)` gives a play's `nonstop` record: how the chart was stitched, where each stage sat in the play with its draws, and the stage of every note.
- `buildNonstopCourseReplay(definition, course, replay)` builds the course replay: the stitched play, each reached stage cut out of it and named by its chart (the host's title and file hashes, and the chart fingerprint of the chart as loaded), and every stage never reached with the facts of its chart as played.

## Finding the stages

`resolveCourseStages(course, lookup)` matches each stage to a local chart: by SHA-256 when the stage has one, else by MD5, as beatoraja's `TableBar` does. A stage carrying both falls back to its MD5 when no chart has the SHA-256. A course with a missing stage is still listed, but it is not `playable`; LR2 shows such a stage as a song you do not own, and beatoraja refuses to start the course.

## Making a course

LR2 lets the player make their own EXPERT, NONSTOP and GRADE courses on the select screen ([L12148-L12269](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L12148-L12269), [L11063-L11137](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L11063-L11137)), and keeps them in its database rather than in `.lr2crs` files. `@be-music/player-engine/course` has the rules as pure functions:

```mermaid
stateDiagram-v2
    [*] --> Browsing
    Browsing --> Making: NEW COURSE bar
    Making --> Making: decide a song (append)
    Making --> Making: remove the last song
    Making --> Browsing: finish (saved)
    Making --> Browsing: cancel
```

- **Adding songs.** `appendCourseDraftStage` adds a song to the end of a `CourseDraft`: at most five songs (`LR2_COURSE_MAKER_MAX_STAGES`), all in the first song's key mode, keyed by the chart's MD5. The same song may appear twice. `removeLastCourseDraftStage` drops the last one, as LR2's right click does.
- **Saving.** `finishCourseDraft` turns the draft into a `CourseDefinition` shaped as `parseLR2CourseFile` would read it back. A NONSTOP course gets the default connection (LR2's button 268) after each of stages 1-5. A GRADE course reads as an LR2 grade (`grade`, `gauge_lr2`). A made course starts unranked (`release: false`): LR2 inserts it with `ir = 0` ([L17588-L17603](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L17588-L17603)) and beatoraja's course editor starts a new course with `release = false`, so its runs stay off the Leaderboard until the player opts in (LR2's IR flag, button 253, is not built yet).
- **The hash.** `buildLR2CourseHash` writes LR2's 32-character header (the connection after each of stages 1-10, `0`-`5`; the type at character 10; zeros elsewhere) and each stage's MD5. LR2 puts the first four characters of the player's password MD5 at characters 28-31; a browser has no password, so they stay `0`.
- **Editing.** `withNonstopConnection` changes the connection after one stage (LR2's buttons 240-248, which step through `stepLR2NonstopConnection`'s order: +1 on the right half, -1 on the left half). LR2 keeps a connection for each of stages 1-9 whatever the course's length.
- **Constraints.** LR2's maker has none to set (its option-ban buttons were never built), so a made course takes `defaultCourseMakerConstraints` (a GRADE course reads as an LR2 grade, no lane option with the LR2 gauge; the others have none) unless the host sets them, as beatoraja's course editor does: `CourseDraft.constraints` while making, `withCourseConstraints` afterwards (one per group, normalized).
- **Sharing.** `serializeLR2CourseFile` writes courses as a UTF-8 `.lr2crs` that `parseLR2CourseFile` reads back into the same courses, but the format has no room for constraints or `release` (every course reads back released). `serializeBeatorajaCourseFile` writes a beatoraja `course/*.json` that keeps both (NONSTOP courses, which beatoraja lacks, are left out).

`CourseMaker` (`@be-music/player-browser/collection`) holds the player's courses and the course being made for a host, and `resolveCourseMakerFolders` lists them as LR2 does: one course folder per kind, each with its courses, then a NEW COURSE bar and, in EXPERT and NONSTOP, a [RANDOM MIX](#random-mix) bar.

## RANDOM MIX

LR2's RANDOM MIX bar draws a course from the library by level, BPM and stage count, then plays it ([L8709-L8775](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L8709-L8775), [L18387-L18474](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L18387-L18474); LR2 beta3 `history.txt`, "ランダムコースオプションについて"). LR2 lists it after NEW COURSE in the EXPERT and NONSTOP course folders, not GRADE ([L18168-L18191](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L18168-L18191)). `drawLR2RandomMix` (`@be-music/player-engine/course`) is the draw as a pure function: the randomness comes in as `random`, so a draw is reproducible.

```mermaid
flowchart TD
    count[Stage count: 1-5, or 2-5 at random] --> first[Stage 1: key mode, level and BPM limits]
    first -->|none| fail[No course]
    first --> window[BPM window: stage 1 max BPM ± range]
    window --> rest[Stages 2+: one random order, one per song folder]
    rest --> prefer[Each stage: the chart of its folder nearest the favorite level]
    prefer --> course[RANDOM MIX course]
```

- **Settings.** `LR2RandomMixSettings` are LR2's `config.course` values, which select buttons 260-266 step and texts 190-196 show ([L11155-L11222](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L11155-L11222), [L6153-L6218](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L6153-L6218)). `stepLR2RandomMixSetting` wraps around at both ends as LR2's `ButtonByInput` does. A level or BPM limit of 0 is no limit.

  | Button | Setting                     | Range       | Default | Text | At 0       | Otherwise |
  | ------ | --------------------------- | ----------- | ------- | ---- | ---------- | --------- |
  | 260    | `preferredLevel` (FAVORITE) | 0-99        | 0       | 190  | `OFF`      | `LEVEL n` |
  | 261    | `maxLevel`                  | 0-99        | 0       | 191  | `NO LIMIT` | `LEVEL n` |
  | 262    | `minLevel`                  | 0-99        | 0       | 192  | `NO LIMIT` | `LEVEL n` |
  | 263    | `bpmRange`                  | 0-99        | 10      | 193  | `NO LIMIT` | `+- nBPM` |
  | 264    | `maxBPM`                    | 0-990 by 10 | 0       | 194  | `NO LIMIT` | `n BPM`   |
  | 265    | `minBPM`                    | 0-990 by 10 | 0       | 195  | `NO LIMIT` | `n BPM`   |
  | 266    | `stageCount`                | 0-5         | 5       | 196  | `RANDOM`   | `n STAGE` |

- **The draw.** A min level above the max level, or a min BPM above the max BPM, is swapped first when both are set, and kept swapped (`resolveLR2RandomMixSettings`), as LR2 writes the swap back. Stage 1 is a chart of the key mode within the level limits whose min and max BPM lie within the BPM limits; with a BPM range set it must also keep one BPM. Stages 2+ come from one random order of the charts within the level limits and the window of the range around stage 1's max BPM (intersected with the BPM limits). A chart from a song folder an earlier stage came from is skipped, so the course can come out shorter than asked. With a favorite level, each drawn chart is replaced by the chart of its folder and key mode within the level limits nearest that level; its BPMs are not checked again. No chart for stage 1 draws nothing.
- **The course.** The draw is a course the player made, named `RANDOM MIX`, in stage 1's key mode, unranked (`release: false`, LR2's `ir = 0`). A NONSTOP draw gets the default connection (button 268) after every stage. `CourseMaker.drawRandomMix` keeps it as the newest course of its folder in place of the folder's previous draw, as LR2 deletes and re-inserts its `RANDOM MIX` row, so it has its own record and replays until the next draw. LR2 finds the previous draw by its title, so it also deletes a course the player named "RANDOM MIX"; be-music remembers which course is its draw instead, and a draw the player renames becomes their own course, which the next draw keeps.
- **Key mode.** The draw takes the select key filter's key mode (`resolveLR2RandomMixKeyMode`): 7 under ALL, as LR2's `CreateRandomCourse` does.

What LR2 leaves unknown, and how be-music reads it:

- LR2 draws with SQLite `random()` (the song order) and DxLib `GetRand` (the random stage count); `random` stands in for both. A draw takes it for the stage count (when random), then stage 1's order, then stages 2+'s. The order of the library's charts stands in for SQLite's row order, which breaks a favorite-level tie.
- Stages 2+ are drawn in the key mode too, as LR2's second query reads the same `mode` condition.
- LR2 keeps a favorite level per key mode (`optimumlevel_5/7/9/10/14`) but only reads the 7-key one, whatever the key mode; be-music has the one value and uses it for every key mode.
- LR2 passes `defaultgauge` (text 199) to its course writer, which does not write it anywhere; be-music has no default gauge for a draw.
- LR2 puts the first four characters of the player's password MD5 into the course hash; a browser has no password, so they stay `0`, as for any course made here.
- LR2 starts the play straight away; be-music shows a course's decide screen first, as it does for every course, and says so in the status line when no chart can be stage 1 (LR2 does nothing).

## Playing a course stage

A host plays a course one stage at a time, passing `PlayerOptions.course` for each: the course `kind`, the course's `gaugeSet` (its `gauge_*` constraint) and `judge` constraint (`no-good` / `no-great`), and `carryIn`, the state the previous stage left (absent for the first stage). The stage records the same object as `play.course` in its replay, so the log replays and re-simulates on its own.

The course's constraints decide how each stage plays. These rules are in `@be-music/player-engine/course`:

- `resolveCourseStageSettings` reads `PlayerOptions.course` (kind, gauge set, judge constraint) from the course;
- `resolveCourseLaneOptions` limits the lane options as beatoraja's `MusicSelector` does: `grade` turns both sides and DP FLIP off, `grade_mirror` keeps a 1P MIRROR and then plays 2P on MIRROR with FLIP on (any other pick turns them all off), and `grade_random` keeps the random family on each side;
- `isCourseHiSpeedLocked` reads `no_speed`;
- `applyCourseLongNoteConstraint` gives a stage chart that leaves its long-note mode undefined the course's `ln` / `cn` / `hcn`;
- an LR2 GRADE course also plays with LR2's resets (`resolveLR2GradeCoursePlaySettings`, see [LR2 `.lr2crs`](#lr2-lr2crs)).

```mermaid
flowchart LR
  s1["Stage 1<br/>gauge 100, combo 0"] -->|"results.course + gauge.final"| s2["Stage 2<br/>carryIn"]
  s2 --> s3["Stage 3<br/>carryIn"]
  s1 -. "gauge emptied" .-> f["course FAILED"]
```

### Course gauges

A course stage runs on the ruleset's course gauge, not on the single-chart gauge. The player still picks GROOVE / EASY / HARD / DEATH; each ruleset maps the pick onto its course line-up.

**`lr2`** (OpenLR2 `LR2f.cpp` L27707-L27790) picks the line by course kind. Every course gauge starts at 100, has no 2 % floor, is pinned at 0 once it falls below 2, and softens BAD / POOR / empty POOR damage ×0.6 below 32 %.

| Kind                   | Pick         | Gauge                         | PG / GR / GD           | BD / POOR / empty POOR                      |
| ---------------------- | ------------ | ----------------------------- | ---------------------- | ------------------------------------------- |
| grade                  | GROOVE, EASY | `GRADE`                       | +0.1 / +0.1 / +0.04    | −2 / −3 / −2                                |
| grade                  | HARD         | `GRADE-HARD`                  | +0.1 / +0.1 / +0.04    | −6 / −10 / −2, × the HARD damage multiplier |
| grade, expert, nonstop | DEATH        | `GRADE-DEATH`, `COURSE-DEATH` | 0 / 0 / 0              | −100 / −100 / 0                             |
| expert, nonstop        | GROOVE       | `COURSE`                      | +0.1 / +0.1 / +0.04    | −1.5 / −2 / −1.5                            |
| expert, nonstop        | EASY         | `COURSE-EASY`                 | +0.12 / +0.12 / +0.048 | −1.2 / −1.6 / −1.2                          |
| expert, nonstop        | HARD         | `COURSE-HARD`                 | +0.1 / +0.1 / +0.05    | −6 / −10 / −2, × the HARD damage multiplier |

**`beatoraja`** plays every course on its class gauges (`GrooveGauge.create`): GROOVE and EASY map to `CLASS`, HARD to `EXCLASS`, DEATH to `EXHARDCLASS`. The table set comes from the course's `gauge_*` constraint, or from the play mode when it names none (5 / 10 keys → `5k`, PMS → `9k`, 24 / 48 keys → `24k`, otherwise `7k`). They start at 100 with no TOTAL modifier. **`____`** has no published class gauge, so it uses beatoraja's.

### Judgment constraints

`no_good` gives GOOD the GREAT window, and `no_great` gives GREAT and GOOD the PGREAT window, on every window table (beatoraja `JudgeManager` L175-L184 sets the window rates to 0, and `JudgeWindowRule.create` widens a window narrower than the one inside it). Under these constraints a press just outside the remaining windows is a BAD. They apply under every ruleset.

### Carried state

- **Gauge**: the next stage starts at the gauge value the previous stage ended on (`results.native.gauge.final`). `resolveCourseStageStartGauge` (`@be-music/player-engine/replay`) names the course gauge and the value a stage starts on before the engine runs, so a host shows that gauge from the stage's READY phase and starts its result graph there.
- **Course combo**: each stage keeps its own combo and max combo, as LR2 and beatoraja do, plus a course-wide combo that runs across stages and breaks where the stage combo breaks (`PlayerSummary.course`, `results.*.course`). The next stage carries in that combo and the course max combo.

### Ending on failure

A survival gauge that empties ends the play there (`PlayerOptions.endOnFailure`, default `true`), so a course stage ends the moment its gauge empties, and the course is failed. The judgment that emptied the gauge is the last one counted.

A stage given up with ESC also ends the course as a failed run. This departs from LR2 on purpose: `LR2body.exe` shows the given-up stage's result as FAILED and, when the gauge is still at 2 % or more and stages remain, goes on to the next stage (the course lamp is FAILED in the end, since a stage was left unplayed); with no GOOD or better judged it returns to the select screen without saving. be-music treats ESC as giving up the course.

A course stage cannot be ranked as a single-chart play: `checkReplayEligibility` marks it `unranked` as `course-stage`, and the Leaderboard stores such a play without ranking it.

### The course run

`CourseRun` (`@be-music/player-engine/course`) is one run of an EXPERT or GRADE course; a NONSTOP course is played as one stitched chart instead ([NONSTOP courses](#nonstop-courses)). A host gives it the course definition and each stage's chart: its own entries (a song entry, a chart file), anything with a `chart` and a `chartPath`, which it hands back with the chart as the course plays it. The run is runtime-neutral, so every host plays courses by the same rules.

```mermaid
stateDiagram-v2
    [*] --> Stage: nextStage
    Stage --> Stage: recordStage (goes on)
    Stage --> Over: recordStage (gauge empty or last stage)
    Stage --> Over: giveUp (ESC)
    Over --> [*]: buildReplay
```

- `nextStage` plans the next stage: its chart with the course's long-note constraint applied, `PlayerOptions.course` with the carry-in, and whether the hi-speed is locked. `playSettings` gives the settings it plays with in place of the player's picks (`resolveCourseStagePlaySettings`: the lane options the course allows, then an LR2 GRADE course's resets).
- `recordStage` records a stage's replay and says whether the run goes on (`goesOnAfter` asks first); `giveUp` records a stage given up with ESC and ends the run as a failed one.
- `playSeconds` adds up the stages' play time, a stage given up up to where it was left (`resolveGivenUpPlaySeconds`). `stageExtras` keeps what the host kept of each stage, such as its result graphs.
- `buildReplay` writes the course replay: the stages played, then every stage never reached with its chart facts, its file hashes and its chart fingerprint.

A course replay plays back through the same run: the browser player rebuilds the course from the log and the charts found (`courseFromReplay`), and each stage plays its recorded replay and records it on the run in place of the live play's, which records none. The run stops where the recorded run stopped, and nothing is kept. See [Replay — Playing a course replay back](./replay.md#playing-a-course-replay-back).

### The course result

The course result sums the stages (see [Replay — Course replays](./replay.md#course-replays)), then:

- **Lamp**: FAILED when a stage ended with its gauge empty or a stage was never reached. A FULL COMBO when the course max combo covers every note of the course (Σ notes == course max combo, as LR2 and beatoraja check), a PERFECT without a GOOD and a MAX with only PGREATs, capped at LR2's and That-Which-Must-Not-Be-Named's FULL COMBO. Otherwise the gauge's lamp: LR2 follows the player's pick (EASY → EASY, HARD → HARD, else NORMAL: LR2 awards HARD only for its HARD-family gauges, so a DEATH clear is NORMAL, LR2body.exe `CheckCourseClear`); beatoraja and That-Which-Must-Not-Be-Named follow the class gauge (`CLASS` NORMAL, `EXCLASS` HARD, `EXHARDCLASS` EX-HARD).
- **BP** (`missCount`): BADs, POORs and empty POORs (LR2 adds an empty POOR to its POOR count, so its BP includes them too), plus every note the run never judged, the unreached stages included (LR2 `CheckCourseClear`, beatoraja `MusicResult`).
- **Trophy** (beatoraja `GradeBar.getTrophy`): the last trophy with `missRate` ≥ BP × 100 / notes and `scoreRate` ≤ EX-SCORE × 100 / (2 × notes).

The lamp and BP are the course rule and BP of the vocabulary every play is lamped with (`resolveCourseClearLamp`, `resolveMissCount` in `@be-music/player-engine/ruleset`). A host keeps a run's best record under the judge ruleset it was played on (`resolveCoursePlayedRuleset`; a run whose stages differ keeps none), by the rules of `@be-music/player-engine/records`: `courseRunRecordPlay` reads what the run contributes, `courseRunKeepsRecord` refuses auto-played runs and runs at another tempo, and `mergeCourseStageRecord` folds an EXPERT / GRADE stage into its chart's record as LR2 does (the best EX score, max combo and BP, and a FULL COMBO or better lamp, but no clear lamp or play count).

Stitch version 3 also promotes BMS-only courses containing CN/HCN to internal bmson so each long note retains its stage mode. This covers both explicit LNMODE and HDX LONGMODE. Historical stitch versions preserve their earlier BMS interpretation. See [ADR 0027](./adr/0027-hdx-long-note-modes.md).

## The player's dan rank

be-music keeps the player's **dan rank** (段位): the highest dan they have earned in each key mode by clearing a GRADE course, under each judge ruleset. It is derived from course clears from now on; records kept before it existed are not read back for one.

### What LR2 and beatoraja do

Sources: OpenLR2 [`LR2f.cpp@583a385`](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp) and beatoraja [`0.8.9` (`8357404`)](https://github.com/exch-bms2/beatoraja/tree/83574048ba489082eb46df7fe9806b464bf1f526).

**LR2 keeps the columns but never fills them.**

- The `player` table of the score database has `grade_7`, `grade_5`, `grade_14`, `grade_10` and `grade_9` beside a `gradeversion` ([L19212](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L19212)).
- They are only read and written back as they are: `ReadPlayerScore` loads them ([L18318-L18326](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L18318-L18326)), `UpdatePlayerStat` saves them ([L16977-L16984](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L16977-L16984)) and `MakePlayerStatHash` folds them into the tamper hash ([L16969-L16974](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L16969-L16974)).
- A broken hash resets them to 0, and so does any `gradeversion` other than 0, with the log line 「段位認定が更新されたのでデータを初期化しました」 ("dan certification was updated, so the data was reset", [L18337-L18380](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L18337-L18380)). This hints at a built-in dan certification with versioned course data that the client was meant to grade **(unverified)**.
- Nothing in OpenLR2 assigns them: the course result (`CheckClear`, the GRADE save path around [L9042-L9192](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L9042-L9192)) keeps the course's own score under its hash and never touches them.
- No skin op reads them. The player-statistics numbers are 30-39 (play count, clears, judgments, combo) and 40 / 41 (`trial`, LR2's built-in mission level, not a dan, [L496-L519](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L496-L519)). No text, image or option op uses them either.
- So LR2's mapping from a GRADE clear to a rank cannot be traced from OpenLR2. Whether `LR2body.exe` fills them somewhere OpenLR2 does not decompile was not checked against the binary **(unverified)**. The dan players see is LR2IR's: the IR site assigns it from the IR's own dan courses (☆ for the normal ladder, ★ for the insane one) **(community knowledge, unverified)**.

**beatoraja stores a rank string from the IR and shows it nowhere.**

- `PlayerInformation` has `rank` (「段位」, [`PlayerInformation.java` L18-L21](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/PlayerInformation.java#L18-L21)), stored in the score database's `info` table ([`ScoreDatabaseAccessor.java` L31-L36](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/ScoreDatabaseAccessor.java#L31-L36)).
- The only writer copies `IRPlayerData.rank` (「段位」, [`IRPlayerData.java` L18-L21](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/ir/IRPlayerData.java#L18-L21)) into a rival's information ([`RivalDataAccessor.java` L143-L149](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/RivalDataAccessor.java#L143-L149)). The IR decides the string; the client never derives one from a course clear.
- Nothing calls `getRank()`. No skin property shows it: the rival string (`STRING_RIVAL`, id 1) is the rival's name ([`StringPropertyFactory.java` L174-L181](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/skin/property/StringPropertyFactory.java#L174-L181)), and `SkinProperty` has no dan id.
- A class course (`grade`, `grade_mirror`, `grade_random`; `CourseData.isClassCourse`, [L84](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/CourseData.java#L84)) keeps its own score and trophy (`CourseResult` [L272](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/result/CourseResult.java#L272), `GradeBar.getTrophy`), and nothing more.

**Where skins show it.** Neither LR2 skins (no number, text, image or option op) nor beatoraja skins (no skin id) have a place for the player's dan rank, on the select screen or the result screen. be-music therefore exposes it to no LR2 or beatoraja skin. The built-in skins draw no player panel and no course trophy, so they show none either; the rank is visible in Debug Menu → Library & records → Local data (`be-music.dan-ranks`).

### be-music's rule

Since neither player defines a mapping, be-music reads the rank from the course's name (`@be-music/player-engine/records`):

```mermaid
flowchart TD
  run[Course run ends] --> keeps{Keeps a record?}
  keeps -->|no: AUTO, other tempo, mixed rulesets| none[No rank]
  keeps -->|yes| grade{GRADE and cleared?}
  grade -->|no| none
  grade -->|yes| name{Name names a dan?}
  name -->|no| none
  name -->|yes| merge[Keep the higher rank<br/>per ruleset and key mode]
```

- **Which runs count** (`resolveCourseRunDanRank`): a GRADE course (`kind: 'grade'`) whose run cleared (any lamp above FAILED), and that keeps a record by the same rule as the course's best record (`courseRunKeepsRecord`, one judge ruleset across the stages). EXPERT and NONSTOP courses earn none.
- **Reading the name** (`recognizeDanRank`): `N級`, `N段` (初段 … 十段), `中伝`, `皆伝`, `発狂N段`, `発狂皆伝` and `Overjoy`, with kanji, full-width or ASCII numerals, anywhere in the name (`GENOSIDE 2018 段位認定 発狂初段`). The `段` of `段位` is not a grade. A course whose name names none, such as Satellite's skill analyzers (`sl0` … `sl12`), earns no rank. This is a heuristic: a course named only `初段` inside an insane table reads as 初段, not 発狂初段.
- **The ladder** (`DAN_RANKS`, lowest first): 十級 … 一級, 初段 … 十段, 中伝, 皆伝, 発狂初段 … 発狂十段, 発狂皆伝, Overjoy. Putting the insane ladder above 皆伝 follows LR2IR's ☆ / ★ display **(community knowledge, unverified)**; it is be-music's choice, not a rule taken from either player.
- **Key mode**: the course's own (`.lr2crs` `line`, a table's `mode`), else its first stage's chart's. LR2 keeps 5 / 7 / 9 / 10 / 14; be-music keeps whichever key mode the course is played in.
- **Keeping it** (`mergeDanRankRecord`): the higher rank wins and keeps the name of the course that earned it; a tie keeps the earlier course. A rank is never lowered by a later failed or lower run.
- **Storage**: `localStorage` `be-music.dan-ranks`, `{ version: 0, ranks: { "<ruleset>:<keyMode>": { rank, course } } }`. Absent storage (from before dan ranks were kept) reads as no rank. "Reset settings" keeps it; "Clear best records" clears it with the best records.

Open: the Leaderboard profile does not show the rank yet, and no skin draws it.
