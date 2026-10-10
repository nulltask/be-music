---
'@be-music/player-web': patch
---

BGA images (`#BMPxx`) and the LR2 skins' stage file, banner and back BMP now look for a `.webp` of the same name first, ahead of `.png` / `.jpg` / `.jpeg` / `.gif` / `.bmp`, so a pack re-encoded to WebP loads without editing its charts. The bytes are decoded by content, so a `#BMPxx foo.bmp` resolved to `foo.webp` decodes as WebP.
