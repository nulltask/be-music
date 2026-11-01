---
'@be-music/player-engine': minor
---

Play options that name a different algorithm in each source can now carry it, as ADR 0019 decides. `@be-music/player-engine/ruleset` adds the registry `QUALIFIED_OPTION_SOURCES` (RANDOM, S-RANDOM, CONVERGE and the one-player BATTLE) and `splitOptionSource`, `optionValueName`, `resolveOptionSource`, `qualifyOptionValue`, `migrateOptionValue`, `isQualifiedOptionName` and `isKnownOptionSource`; `@be-music/player-engine/lanes` adds `isOnePlayerBattleMode`. A bare value stays the judge ruleset's own, so existing replays keep their meaning.

`beatoraja:BATTLE` and `____:BATTLE` build their source's chart under every judge ruleset, and the assist resolver classifies them by their own source (beatoraja's is LIGHT_ASSIST, That-Which-Must-Not-Be-Named's saves nothing). Replays accept the qualified battle modes, and a course's `grade_random` keeps a qualified RANDOM or S-RANDOM.

Two-player play (`TWO-PLAYER`) no longer fails under beatoraja rules: LR2's BATTLE builds the chart and each player is judged with beatoraja's windows and gauges. Long-note addition (ADD LN / CN / HCN / ALL) no longer fails outside beatoraja rules; the added long notes are judged as the ruleset's own, so CN and HCN differ from LN only under beatoraja rules.
