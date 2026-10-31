---
'@be-music/chart-parser': patch
---

Read nanasi `#EXBPMxx` as an alias of `#BPMxx`. Channel `08` tempo changes that only `#EXBPMxx` defined were dropped as undefined references, so such charts kept the previous tempo. The alias is stored and written back as `#BPMxx`, follows the file-order rule for its index and applies inside control-flow branches; Be-Music JSON that kept it in `metadata.extras` migrates into `resources.bpm` unless `#BPMxx` defines the index.
