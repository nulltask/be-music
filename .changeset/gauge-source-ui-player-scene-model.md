---
'@be-music/player-scene-model': minor
---

The `gauge1P` and `gauge2P` play options now take a source-qualified gauge pick (`lr2:HARD`, `beatoraja:EX-HARD`) besides a bare gauge type. `keepGaugePick` is the ruleset-change rule: a qualified pick stays, and a bare one the new ruleset lacks returns to GROOVE. `cyclePlayOptionValue` steps on from a qualified pick's gauge type, and `formatGaugeLabel` labels it by that type.
