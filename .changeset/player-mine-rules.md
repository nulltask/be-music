---
'@be-music/player': minor
---

Detonate mines by the judge ruleset's rule, in the engine and the play-log simulators alike. The `beatoraja` ruleset detonates a mine only when its lane is down as the mine crosses the judge line, as beatoraja's `JudgeManager` does, so a press shortly before or after no longer drains the gauge. `lr2` keeps LR2's model (also a press inside the PGREAT window), and `iidx`, which has no mines, keeps it too; the simulators, which only knew the hold-through rule, now apply LR2's press rule under `lr2` / `iidx`. The ruleset config (`resolveRulesetConfig`) names the rule as `mineTrigger` (`'press-or-hold'` / `'hold'`).

Whether a lane was down at a crossing is read off its recorded presses and releases, so a tap released just before a mine no longer counts as held, a second key on a held lane no longer cancels the hold, the simulator keeps a lane held by two keys down until both come up, and live play, replays and the simulators agree; an input at the crossing's very instant counts before the crossing.

Fix a bmson mine without `damage` taking its damage from the WAV slot the parser assigned to its channel, read as base 36, so adding sound channels to a chart changed how much its mines hurt: such a mine now deals the default 4 (%), the same fallback as an invalid BMS mine value.
