# @be-music/utils

## 0.3.0

### Minor Changes

- ca1012c: Add the `@be-music/utils/optional-node-module` subpath with `loadOptionalNodeModule`, a loader for optional dependencies (native addons, large wasm packages) that falls back to `createRequire` resolution anchored next to the executable, the directory named by the `BE_MUSIC_OPTIONAL_NODE_MODULE_DIR` environment variable, and the working directory. Inside a Node single executable application (SEA), `import()` of a bare specifier always fails, so this lets SEA binaries load such modules from a `node_modules` directory shipped alongside them or extracted from embedded assets.

## 0.2.1

### Patch Changes

- 73dff9a: Extract shared file-lookup helpers onto the package root: `findCaseInsensitiveMapPath`, `lookupCaseInsensitiveMapEntry`, `loadFileEntryBytes`, `readFilesIntoEntryMap`, and `isAudioAssetPath`.

## 0.2.0

### Minor Changes

- 632f274: Add `normalizeAsciiBase62Code` so callers can handle beatoraja `#BASE 62` object IDs (`0-9A-Za-z`). Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

- 135f822: Split the Node-facing CLI / logging / PCM helpers out of the package root into narrow subpath exports so browser bundles can import only the helpers they need without pulling in `node:fs/promises` / `node:path`.

  New subpaths (the package root still re-exports each for backward compatibility):

  - `@be-music/utils/cli-path` — `resolveCliPath`
  - `@be-music/utils/log` — file logger / no-op logger / `LogEntry` / `Logger` types
  - `@be-music/utils/pcm` — `writeStereoPcm16Le` and surrounding PCM helpers

### Patch Changes

- 135f822: `resolveCliPath` now resolves absolute-path arguments correctly under pure-ESM Node runtimes (`tsx`, `node --import tsx/esm`). The previous slow path silently fell back to `cwd` when its lazy `eval('require')` lookup threw.

## 0.1.0

### Minor Changes

- Initial release.
