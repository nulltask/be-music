---
'@be-music/beatoraja-skin': patch
---

Cache a `BeatorajaPathIndex` per source map (WeakMap-keyed) that groups files by lowercased parent directory. `expandBeatorajaWildcard` used to walk every key in the source map and re-run `path.toLowerCase()` + `lastIndexOf('/')` per call — once per `source[]` entry in `bundleBeatorajaSources`. Now resolves in `O(filesInTargetDir)` via the precomputed directory bucket. `describeMissingWildcardDirectory` shares the same index instead of running two more full scans.
