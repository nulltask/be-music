---
'@be-music/player-web': minor
---

Built-in skin updates:

- Held long notes show it: in Synesthesia the lane's stretch of the judgement line glows in the lane's colour and embers keep rising from it (thinned with reduced effects, glow only with effects off), and in Plain the line glows and white sparks rise. A long note's tail shows whether it is judged: under LR2 (LN, tail not judged) it is drawn translucent, where to let go, and under beatoraja / IIDX CN and HCN (judged on release) it keeps the solid cap. Long-note bodies lose the white line down their middle.
- The audio-reactive spectrum follows human hearing: its 16 bands are spaced on the ERB-rate scale (the lowest spans 23-94 Hz instead of one noisy FFT bin), each is A-weighted at its centre, and one automatic gain is shared by all bands, so the spectrum keeps its shape instead of every band swinging to full height. Onset detection weights only the bands below about 200 Hz as low end.
- The select list follows the finger: smooth scrolling on a trackpad moves one entry per row of travel (a notched wheel still moves one per notch) instead of racing ahead, and on a touch screen the list glides after a swipe and settles onto a row; the skins draw the rows at the list's pull through the skin SDK's `listScroll`.
- The select screens show the focused chart's judge rank (`#RANK` / `#DEFEXRANK`): Synesthesia between the MODE / BPM / LEVEL chips and the level lights, Plain as a third row of facts (landscape) or at the end of the artist line (portrait).
- A folder or course row's count takes the width it needs, up to a cap, instead of a fixed 64-84 px that cut it short.
