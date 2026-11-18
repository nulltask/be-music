---
'@be-music/chart-source': patch
---

Speed up `cloneJSON` by about three times: cloned events keep the object shapes of parsed events instead of spreading their optional fields in, so the chart editor's edits, which clone the chart, are fast again.
