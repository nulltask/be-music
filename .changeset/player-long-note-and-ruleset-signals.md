---
'@be-music/player': minor
---

The engine now tells UI runtimes about long-note holds and about the ruleset a play is judged under, so a renderer no longer has to guess them from lane presses or re-derive the judge windows.

- `PlayerUiCommand` gains `long-note-start` (channel, head beat, and the `ln` / `cn` / `hcn` mode the active ruleset actually plays the note in) and `long-note-end` (channel and a `complete` / `dropped` outcome). They are pushed in autoplay, auto-scratch, and manual play, next to the existing `hold-lane-until-beat` / `release-lane` pair.
- `PlayerOptions.onRulesetResolved` is called once before playback with a `PlayerRulesetInfo`: the ruleset id, its long-note style, and its judge window tables in µs, after the judge ruleset, the debug window override, and a replay's recorded settings were applied. Under LR2 the tables are the ones in force at the start of the chart; a later `#EXRANKxx` change is not reported.
