---
'@be-music/player-terminal': patch
---

Apply EXBMP transparent-color keys to native still-image pixels before resizing and sub-region cropping. Preserve unkeyed black pixels, distinguish encoded alpha from inserted RGBA bytes and separate caches for different keys of the same image, including implicit POOR and stitched resources. Expand indexed PNG palettes, packed grayscale and encoded PNG transparency before keying.
