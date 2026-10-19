---
'@be-music/skin-sdk': patch
---

Fix `validateBeMusicSkin` passing a skin without `fontLoads`, and throwing on one without `label` or `author`. A skin written in plain JavaScript can leave out what the type requires: the missing `fontLoads` reached the host, which crashed loading the skin's fonts, and a missing `label` or `author` made the validator itself throw. It now reports each as a problem (`fontLoads` must be an array of font strings, empty when the skin loads no web fonts), so `defineBeMusicSkin` throws where the skin is defined and a host's skin registry refuses the skin with the reason.
