---
'@be-music/player-browser': patch
---

The select-screen chart preview no longer sounds louder than the chart's play: it now plays at the play's mixer headroom (about −6 dB) and takes the chart's `#VOLWAV`, as the play does, where it used to sum its samples at unity.
