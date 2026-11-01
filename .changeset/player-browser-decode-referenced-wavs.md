---
'@be-music/player-browser': patch
---

A play decoded every declared `#WAV` sample, including ones no note or BGM ever plays, and each decoded sample costs its whole PCM. It now decodes only the samples some event plays, and a file behind several slots once. A short cut that declares the full track's 1,041 samples but plays 578 of them took about 210 MB less memory during play and started sooner.
