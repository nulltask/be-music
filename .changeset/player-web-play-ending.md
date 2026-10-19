---
'@be-music/player-web': patch
---

A play cut short by its gauge emptying ended abruptly: on the built-in and LR2 screens the chart played on for the usual lead-out and the sound was cut when the result appeared, and a beatoraja play jumped to its result at once. It now stops at once, as LR2 and beatoraja do: the skin's failure timer starts (LR2 timer 3, beatoraja `TIMER_FAILED`) with no fade-out, the sound is cut, and the result shows after the skin's close time (LR2 `#CLOSE`, beatoraja `close`, which a beatoraja play ignored); the built-in skin, which has none, fades its picture over 1.5 s. A beatoraja play that reaches its end, an auto play included, now holds for the same lead-out after the last note before the skin's fade-out, as the other families do.

A play that ends normally, and Escape or F5, no longer start LR2 timer 3 or wait for `#CLOSE` after the fade-out: the stock LR2 theme drew its shutters and FAILED plate over a cleared play and held it 2 s longer. They start timer 2 alone and move on once `#FADEOUT` is over, as LR2 does.
