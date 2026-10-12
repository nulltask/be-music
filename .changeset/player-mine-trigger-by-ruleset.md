---
'@be-music/player': minor
---

Make mine detonation follow the judge ruleset, in the engine and the play-log simulators alike. The `beatoraja` ruleset now detonates a mine only when its lane is down as the mine crosses the judge line, as beatoraja's `JudgeManager` does; a press shortly before or after no longer drains the gauge. `lr2` keeps LR2's model (also a press inside the PGREAT window), and `iidx`, which has no mines, keeps it too. The simulators, which only knew the hold-through rule, now apply LR2's press rule under `lr2` / `iidx`. `RulesetConfig` gains `mineTrigger` (`'press-or-hold'` / `'hold'`). Whether a lane was down at a crossing is read off its recorded presses and releases, so a tap released just before a mine no longer counts as held, a second key on a held lane no longer cancels the hold, and live play, replays and the simulators agree; an input at the crossing's very instant counts before the crossing.
