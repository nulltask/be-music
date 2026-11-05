---
'@be-music/app-play': minor
---

Deciding a RANDOM MIX bar no longer freezes the page on a large library: it used to hash every chart file and resolve every chart's tempo map at once, and now reads a chart's BPMs only when a draw walks it and hashes only the charts drawn. A RANDOM MIX now opens a dialog first that sets the key modes, a level range or the difficulties, the number of stages and the number of loops (either count can be Infinity); OK starts the mix from the charts that fit, and the dialog opens on the conditions last confirmed. An endless mix draws each stage as the run reaches it. A draw of more than five stages, or an endless one, is played without being kept as a course.
