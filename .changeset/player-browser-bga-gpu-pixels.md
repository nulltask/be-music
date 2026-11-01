---
'@be-music/player-browser': patch
---

EXBMP / SWBGA colour-keyed video and the plane tint given to Canvas skins read every frame back with `getImageData`, about 2.6 ms of main-thread time per 640×480 frame and 3.2 ms at 1280×720. They now run through one shared WebGL2 shader and copy the result on the GPU (about 0.015 ms per frame), falling back to the CPU where WebGL2 is unavailable or its context is lost. The keying rules and the tinted colours are unchanged.
