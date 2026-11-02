---
'@be-music/player-terminal': patch
---

`bms-replay` no longer stops on a replay a ruleset cannot read: it prints that ruleset as not simulated with the reason, and marks a result judged only up to the played run's failure as TRUNCATED.
