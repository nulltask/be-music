---
'@be-music/player-web': patch
---

Fix gameplay recordings drifting out of sync with their audio on high-DPR displays: a canvas larger than 1920×1080 is now scaled down before encoding (configurable via `maxVideoSize`), since software VP9 could not encode ~3000×2000 frames in real time and dropped frames until the video stuttered behind the sound.
