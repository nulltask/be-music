---
'@be-music/player-web-demo': patch
---

Reading the test hook (`window.__beMusicTest.state()`) with a chart bar under the cursor started hashing that chart, although the hook is a read-only view. A read now uses only the hashes already known: a chart's record by its hash once the select screen has hashed the chart, by its path before.
