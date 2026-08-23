# @be-music/beatoraja-skin

## 0.1.2

### Patch Changes

- Updated dependencies [ca1012c]
  - @be-music/utils@0.3.0

## 0.1.1

### Patch Changes

- 69f77d1: Cache a `BeatorajaPathIndex` per source map (WeakMap-keyed) that groups files by lowercased parent directory. `expandBeatorajaWildcard` used to walk every key in the source map and re-run `path.toLowerCase()` + `lastIndexOf('/')` per call — once per `source[]` entry in `bundleBeatorajaSources`. Now resolves in `O(filesInTargetDir)` via the precomputed directory bucket. `describeMissingWildcardDirectory` shares the same index instead of running two more full scans.
- Updated dependencies [73dff9a]
  - @be-music/utils@0.2.1

## 0.1.0

### Minor Changes

- 06a2db9: Initial release: a renderer-independent parser and normalizer for beatoraja's JSON and Lua skin formats.

  Covers the 2-phase Lua evaluation contract (`skin_config = nil` → header → populated `main()`) on a Fengari sandbox, `if` / `values` flattening, `*` wildcard / `filepath[]` overrides, case-insensitive asset lookup, and per-scene theme discovery (play / select / decide / result / course-result / grade-result). Scene elements have strict-typed normalizers (`image`, `imageset`, `value`, `float-value`, `text`, `slider`, `note`, `judge`, `gauge`, and the rest) with keyframe carry-forward, linear interpolation, `loop` wrap-around, and `divx` / `divy` cell math. `skin/default/` discovery wins ties against community themes that shadow it.
