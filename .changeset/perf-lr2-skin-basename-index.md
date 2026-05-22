---
'@be-music/lr2-skin': patch
---

Cache a `BasenameIndex` per source map (WeakMap-keyed) bucketed by lowercase basename, with parent / grandparent path slices precomputed so `resolveLr2IncludePath` / `resolveLr2AssetBytes`'s suffix-match comparisons don't re-lower on every call. The LR2 default theme ships hundreds of files; the previous `[...sourceFiles.keys()].find(...)` pattern dominated theme load + every per-frame `#CUSTOMFILE` resolve.
