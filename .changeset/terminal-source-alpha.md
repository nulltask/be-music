---
'@be-music/player-terminal': minor
---

Renderer source frames accept optional per-pixel alpha coverage. Semi-transparent PNG and encoded-alpha BMP BGA pixels now blend with lower planes instead of becoming opaque or disappearing. Preserve source coverage through EXBMP keying, sub-region crops, nearest/Lanczos scaling and worker transfers, combine it with plane opacity and tint, and flatten the final result against the BGA background for ANSI and Kitty. Filter associated RGB during resizing to avoid transparent-color fringes. A 32-bit BMP whose alpha bytes are all zero stays opaque, as browsers decode it.
