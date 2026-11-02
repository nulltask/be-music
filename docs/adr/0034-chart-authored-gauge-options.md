[日本語](./0034-chart-authored-gauge-options.ja.md)

# 0034: Map chart-authored GAMELEVEL and EXTRA onto each ruleset's own gauges

## Context

nanasigroove lets a chart's initial `#OPTION` choose `774:GAMELEVEL_*` (BEGINNER, NORMAL, HYPER, DANGER: the stage's clear and fail conditions) and `774:EXTRA_*` (EASY, HARD, VERYHARD: how fast that gauge rises and falls). Neither is allowed on A6. [hitkey's catalog](https://hitkey.nekokan.dyndns.info/option.htm) measured each pair on nanasigroove 1.552 with `#TOTAL 400`:

| GAMELEVEL | Start | Clear | Fail   | EXTRA effect                                                                        |
| --------- | ----- | ----- | ------ | ----------------------------------------------------------------------------------- |
| BEGINNER  | 30 %  | 70 %  | none   | EASY recovers more; HARD and VERYHARD behave like NORMAL                            |
| NORMAL    | 25 %  | 80 %  | none   | EASY recovers more; HARD starts at 80 % and fails at 0 %; VERYHARD at 60 %, harsher |
| HYPER     | 50 %  | 90 %  | 0 %    | EASY is unchanged; HARD and VERYHARD drain much faster                              |
| DANGER    | 100 % | any   | 5 MISS | EASY is unchanged; HARD and VERYHARD fail on the first MISS                         |

The catalog does not say how these values scale with the note count or TOTAL, and nothing says how they interact with Be-Music's three judge rulesets, whose gauges, TOTAL handling and clear lamps differ. The owner decided that a chart's option wins over the player's own setting of the same item (#845).

## Decision

**Map, do not import.** A chart's pair selects one gauge of the shared vocabulary, and the play's judge ruleset runs that gauge with its own numbers, TOTAL handling, clear border and lamps. Copying nanasigroove's percentages would add a fourth gauge family with no scaling rule and no lamp of its own. The row is the ruleset gauge whose behavior is closest:

| GAMELEVEL \ EXTRA | OFF    | EASY        | HARD    | VERYHARD |
| ----------------- | ------ | ----------- | ------- | -------- |
| BEGINNER          | EASY   | ASSIST-EASY | GROOVE  | GROOVE   |
| NORMAL            | GROOVE | EASY        | HARD    | EX-HARD  |
| HYPER             | HARD   | HARD        | EX-HARD | EX-HARD  |
| DANGER            | DEATH  | DEATH       | DEATH   | DEATH    |

An EXTRA without a GAMELEVEL applies to NORMAL, nanasigroove's default. A gauge the ruleset lacks falls back one step toward GROOVE: LR2 plays ASSIST-EASY as EASY and EX-HARD as HARD, and `____` plays DEATH as EX-HARD (beatoraja has the whole line-up; its DEATH is HAZARD). Later declarations win within GAMELEVEL and within EXTRA; `EXTRA_OFF` clears EXTRA; legacy `GLV-*` aliases stay unsupported. **Judge windows are unchanged**: the catalog describes these options as gauge conditions only.

**Precedence.** The chart's gauge replaces the player's gauge pick, and in a two-player play both players' picks. A course stage keeps its course gauge rule, because the course, not the chart, defines how a run carries its gauge. NONSTOP plays a stitched chart without stage options. beatoraja PRACTICE keeps its own gauge. The player's gauge auto-shift policy still applies, starting from the chart's gauge: it is a separate option the chart does not set.

**Where.** The engine applies the mapping when it starts a live play (`resolveChartGaugeType` in `@be-music/player-engine/ruleset`), and the browser shows the same gauge (`resolveSelectedGauge`). A replay is driven by its recorded `play.gauge`, so an existing replay never switches gauge, and a replay of such a chart re-simulates on the gauge it played.

**Records.** `play.gauge` records the effective gauge. The clear lamp is that gauge's lamp under the ruleset, as for a player's own pick, so a HYPER chart under LR2 lamps HARD CLEAR. A gauge is not an assist under the [assist policy](./0031-assist-record-policy.md), so eligibility is unchanged.

## Consequences

A chart's gauge choice plays and records deterministically on every ruleset and host, and its lamps stay the ruleset's familiar ones. The difference from nanasigroove is deliberate: BEGINNER's 70 % border becomes the ruleset's EASY border, HYPER's 90 % clear border on a failing gauge becomes the ruleset's HARD, and DANGER's five-miss allowance becomes the first-break DEATH. Changing a row later changes which gauge new plays run, but never an existing replay.
