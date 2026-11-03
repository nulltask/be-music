---
'@be-music/player-browser': minor
---

The decide, play and result screens take START, SELECT and the lane keys as LR2 and beatoraja do, by the skin family's key map.

- **Decide.** The lane keys continue (LR2: any, beatoraja: keys 1 / 3 / 5 / 7), and START + SELECT backs out.
- **Play.** START + a key steps the hi-speed (odd keys down, even up); on LR2's map SELECT does the same, and keys 6 / 7 move SUDDEN+ while it shows; on beatoraja's START + the turntable moves it. START twice switches SUDDEN+. START + SELECT held for a second quits, and after the last note either one ends the play. Escape held through the fade-out plays the chart again (That-Which-Must-Not-Be-Named PC's quick retry). On beatoraja's map ↑ / ↓ move the lane cover instead of the hi-speed; on LR2's ← / → move it outside AUTO play. `PlaySessionOptions.controlScheme` and `builtInControlScheme` carry the key map.
- **Result.** The lane keys move on (LR2: any, beatoraja: keys 1–4). Keys held as the screen leaves retry the chart: a white and a black key on LR2's map, key 5 or 7 on beatoraja's, or Escape held for `QUICK_RETRY_HOLD_MS`.
