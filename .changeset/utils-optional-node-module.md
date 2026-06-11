---
'@be-music/utils': minor
---

Add the `@be-music/utils/optional-node-module` subpath with `loadOptionalNodeModule`, a loader for optional dependencies (native addons, large wasm packages) that falls back to `createRequire` resolution anchored next to the executable, the directory named by the `BE_MUSIC_OPTIONAL_NODE_MODULE_DIR` environment variable, and the working directory. Inside a Node single executable application (SEA), `import()` of a bare specifier always fails, so this lets SEA binaries load such modules from a `node_modules` directory shipped alongside them or extracted from embedded assets.
