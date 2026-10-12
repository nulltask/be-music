---
'@be-music/stringifier': patch
---

A regenerated BMS file leaves out a branch header that a later top-level line overrides (`overriddenByLaterHeader`). This layout writes every top-level header before the control flow, so writing the branch line would let it win again when the file is read back.
