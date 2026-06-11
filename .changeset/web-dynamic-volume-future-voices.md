---
'@be-music/player-web': patch
---

`#xxx97` / `#xxx98` dynamic volume changes in the WebAudio session now apply only to voices triggered after the event, matching the documented semantics and the Node engine. Previously the web runtime wrote the new gain onto the shared bus mixers, retroactively changing the volume of already-playing voices.
