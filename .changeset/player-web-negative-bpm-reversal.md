---
'@be-music/player-web': minor
---

Render LR2's negative-BPM reverse scroll (#134): the LR2 / default gameplay scenes and the beatoraja scene scroll notes and measure lines from the mirrored display clock past the reversal, the BGA holds its image from the reversal, and the BPM readouts freeze at the reversal value. Add `beatorajaDisplayScrollBeat` for the beatoraja display layers. The BPM graph, HS-fix range, and beatoraja timing use |BPM| for negative `#BPMxx`, and the select-scene chart preview drops triggers at or after the reversal.
