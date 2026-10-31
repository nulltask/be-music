---
'@be-music/player-browser': patch
---

Prepare separate WAVCMD/EXWAV effect buffers per sample slot before tempo stretching. Read encoded native sample rates for frequency effects, preserve base-62 slot identity and reuse the resulting duration through seek/retrigger. Host decoding supplies native sample rates for unprepared frequency-effect buffers.
