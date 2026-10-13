---
'@be-music/player-web': patch
---

Shape the audio-reactive spectrum after human hearing: the 16 bands are now spaced on the ERB-rate scale (so the lowest band spans 23-94 Hz instead of a single, noisy FFT bin), each band is A-weighted at its centre, and one automatic gain is shared by all bands instead of one per band, so the spectrum keeps its shape (loud mids, quieter sub-bass and air) instead of every band swinging to full height. Onset detection now weights only the bands below about 200 Hz as low end.
