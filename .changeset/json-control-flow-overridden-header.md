---
'@be-music/json': minor
---

Add `overriddenByLaterHeader` to `BMSControlFlowHeaderEntry`: `true` when a top-level line later in the file defines the same header, so the branch line never takes effect under the file-order rule LR2 and beatoraja apply.
