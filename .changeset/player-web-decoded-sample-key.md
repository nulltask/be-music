---
'@be-music/player-web': patch
---

Fix samples whose `#WAV` path has `./`, `..` or doubled slashes staying silent on beatoraja skins: the beatoraja play cached decoded samples under a key that only lower-cased the path, while the audio session looks them up by the fully normalized path. Both now use one key, `decodedSampleKey`.
