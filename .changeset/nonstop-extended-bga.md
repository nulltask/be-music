---
'@be-music/player-engine': patch
---

Preserve EXBMP-only filenames and BGA sub-region dependencies when stitching NONSTOP courses. Remap each stage's resource ids and asset paths, retain authored color fields and crop placement, and include dependency ids in the stage map. Resolve dependency graphs iteratively, isolate cycles and report id-space exhaustion when a referenced source cannot be allocated.
