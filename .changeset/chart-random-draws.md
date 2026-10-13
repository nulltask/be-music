---
'@be-music/chart': minor
---

Add the control-flow evaluator and the `RandomDraws` value it runs on. `drawRandomOutcomes(source, random)` draws the outcome of every `#RANDOM` / `#SETRANDOM` / `#SWITCH` / `#SETSWITCH` line once, in file order (single-outcome and `#SET…` lines are recorded without consuming the random source), and `evaluateControlFlow(source, draws)` lists the header and object lines those draws make active, so a chart's branches are decided by one explicit value that the player, the play log and hashing can share. `hasControlFlow` tells whether a chart still needs resolving.
