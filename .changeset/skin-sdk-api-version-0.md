---
'@be-music/skin-sdk': minor
---

Mark the skin API as still being defined: `BE_MUSIC_SKIN_API_VERSION` is now `0`, a development revision that may change incompatibly without the number moving (the first stable one will be `1`). `isSupportedBeMusicSkinApiVersion` still accepts `1`, so skins declared before this change keep running.
