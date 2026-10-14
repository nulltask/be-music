---
'@be-music/player-web': patch
---

Read the beatoraja skins' current BPM (NOWBPM and the green / white number readouts) with a binary search over the chart's tempo segments instead of walking them from the start, several times a frame. The readout is unchanged.
