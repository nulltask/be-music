---
'@be-music/player-browser': minor
---

Add `PlayScene.setBGACamera({ stream, mirror })`, which shows a camera `MediaStream` in the BGA frame in place of the chart's BGA on every play screen: the built-in skins, LR2 skins and beatoraja skins, and a Be-Music Skin that composites the BGA itself. The picture is fitted whole on black, can be mirrored, and the chart's BGA comes back on the next frame after `setBGACamera(undefined)`.
