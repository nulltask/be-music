---
'@be-music/player-web': minor
---

Play logs recorded in the browser now carry `chart.chartFingerprint`, and the beatoraja scene's `chart.playFingerprint` no longer changes with DP FLIP: both gameplay scenes hand the engine a resolved chart (and the beatoraja scene a DP-flipped one), so the fingerprints were computed from that working copy. The core gameplay scene now passes the song's chart as `recordPlaylog.sourceChart`, and `PixiBeatorajaGameplayView` takes a new `sourceChart` option that it forwards the same way.
