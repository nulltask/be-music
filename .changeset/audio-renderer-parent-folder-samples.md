---
'@be-music/audio-renderer': patch
---

Fix keysounds missing for 差分 (alternate difficulty) charts shipped in a sub-folder: `resolveSamplePath` now tries every candidate once more one folder up when none is found beside the chart, as LR2 does.
