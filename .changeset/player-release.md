---
'@be-music/player': minor
---

Provide one resolved-chart and deterministic judging pipeline for live play, replays and score verification.

- Add EXPERT, GRADE and stitched NONSTOP courses, course fingerprints, constraints, random-course filters, course drafting and serialization, carry-over rules, trophies and complete course play logs. Newly created courses start unranked.
- Add shared `ruleset` and `records` APIs for judgments, ranks, clear lamps, gauges, best records and course records.
- Record chart/play fingerprints, explicit RANDOM outcomes, recorder identity, early/late counts, input-release capability, display state and ranking eligibility in play logs.
- Support tempo changes, practice eligibility, immediate survival-gauge failure and an optional post-chart hold for scene outros.
- Play 24/48-key wheel lanes, negative-BPM reversal, SCROLL/SPEED changes and lane modes using shared chart rules.
- Match live and simulated results for long-note modes, mines, scratch/FREE ZONE behavior, dynamic judge windows, gauge selection, aborts and key releases. Process timed judgments deterministically at whole-microsecond boundaries.
- Apply LR2's DEATH gauge table and preserve the default BMP00 POOR image unless POORBGA is 2.
- Support qualified random-course SQL filters with ordering and limits, reject ambiguous columns, and accelerate simulation with binary searches.

Migration: the root exports the engine; use `/signals`, `/lanes`, `/display`, `/ruleset`, `/playlog`, `/records`, `/course` and `/audio-sink` instead of removed file-based subpaths. Import chart timing and timelines from `@be-music/chart`. Use canonical uppercase-abbreviation names and `PlayerOptions` settings/runtime/tuning/debug/recording types. Resolve control flow once with `resolvePlayChart` and pass its chart and random draws to the engine; unresolved control flow without draws is rejected.
