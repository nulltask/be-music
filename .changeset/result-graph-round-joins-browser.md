---
'@be-music/player-browser': patch
---

Fix thin spikes and bowl-shaped blotches on the Synesthesia result screen's GROOVE GAUGE and EX SCORE graphs: the graphs sample on every judgment, and samples a fraction of a pixel apart made near-zero-length segments whose joins broke into stray fans on the glow. Those samples are now thinned out before stroking, and the line and its glow are stroked with round joins instead of miter joins.
