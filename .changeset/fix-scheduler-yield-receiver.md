---
'@be-music/player-web': patch
---

Call `scheduler.yield()` through the `scheduler` receiver instead of extracting the method into a bare variable. Detached method invocation lost the `this` binding and crashed with `Illegal invocation` on browsers that ship the Scheduler API natively, so `loadSongCollectionFromFiles` froze mid-parse on Chrome's scheduler-yield code path. The `setTimeout(0)` fallback for browsers without the API is unchanged.
