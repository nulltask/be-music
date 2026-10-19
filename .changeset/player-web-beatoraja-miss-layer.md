---
'@be-music/player-web': patch
---

beatoraja play BGA fixes:

- The POOR image stayed until the next judgment that was not a POOR. It now shows for 500 ms from the miss, beatoraja's default `misslayerDuration`, whatever is judged meanwhile, as `BGAProcessor` draws it.
- Only one image was drawn: the layer (`#xxx07`) hid the base (`#xxx04`) whenever both were set. The layer now draws over the base with its black keyed out, and the POOR image replaces both during a miss.
