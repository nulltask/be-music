---
'@be-music/player-terminal': patch
---

Load BGA images declared only through `#EXBMPxx`, including the implicit POOR image in slot `00`, instead of displaying a missing-resource frame. Preserve explicit `#BMPxx` filenames when both declarations exist; EXBMP tint and alpha remain unsupported in terminal playback.
