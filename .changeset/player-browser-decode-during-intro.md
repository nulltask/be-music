---
'@be-music/player-browser': patch
---

A play with no decide screen decoded every sample before its intro began, so the wait was the decode plus the intro. It now opens its audio graph, starts the intro and decodes alongside it, holding the chart until the samples are in, so the wait is the longer of the two: a 1,285-sample chart went from about 4.8 s to 3.4 s between picking it and its first note. Samples also decode one per core (4 to 16) instead of eight at a time.
