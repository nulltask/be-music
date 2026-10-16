---
'@be-music/beatoraja-skin': minor
---

`@be-music/beatoraja-skin/scene` maps the decide screen too, from the chart about to be played and how far the play behind the screen has loaded (`BeatorajaDecideInput`): `resolveBeatorajaDecideOps` lights the chart's difficulty ops and `NOW_LOADING`, then `LOADED`; `resolveBeatorajaDecideNumber` reads the chart's `#PLAYLEVEL`, its listed BPM on the BPM numbers and the loading progress in percent (165), and 0 for every other number; `resolveBeatorajaDecideGraphValue` fills the loading bar (graph type 102). This is what player-web's beatoraja decide screen read of a chart, now in the scene mapping.
