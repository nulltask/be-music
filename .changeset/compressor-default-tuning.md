---
'@be-music/player-web': patch
---

Retune the default gameplay compressor stack so keysounds keep their attack.

- Key bus: a slower attack (12 ms) lets each hit's transient through before compression, with a gentler ratio (3:1), a firmer knee, and a faster release so one hit's gain reduction doesn't dull the next.
- BGM bus: lighter glue (2:1 from −10 dB) with a 25 ms attack, so the background bed sits steadily under the keysounds while its drums keep their own attack.
- Master: a firmer, less intrusive ceiling (−1.5 dB, 20:1, 2 ms attack, 150 ms release) that catches clipping peaks without shaving the front of every hit or pumping on bass.
- The `legacy` single-compressor mode is unchanged.
