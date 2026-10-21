[Japanese version](./shared-utils.ja.md)

# Shared utilities

`@be-music/shared-utils` owns general operations reused across packages. Import narrow subpaths in browser and runtime-neutral code; the package root also exports Node-specific file and logging helpers.

| Entry     | Runtime          | Purpose                                                         |
| --------- | ---------------- | --------------------------------------------------------------- |
| `./core`  | Browser and Node | Numeric bounds, fractions, ASCII codes, asset entries and paths |
| `./hash`  | Browser and Node | Synchronous SHA-256 and native asynchronous SHA-256             |
| `./async` | Browser and Node | Bounded waiting for cleanup with an injectable timer            |
| `./cli`   | Node             | Main-module detection for normal CLI and SEA startup            |
| `./pcm`   | Node             | Stereo PCM16 output into buffers                                |

## Hashing

`sha256Hex(text)` hashes UTF-8 text synchronously. `sha256HexOfBytes(bytes)` hashes the selected bytes of a typed array. `sha256HexAsync(textOrBytes)` uses Web Crypto and returns a promise. Every variant returns lowercase hexadecimal SHA-256. Keep the synchronous path for deterministic fingerprint construction; services and browser file hashing can use native asynchronous hashing. The existing `@be-music/chart-model` export of `sha256Hex` remains available.

## Cleanup deadlines

`settleWithTimeout(task, timeoutMs, scheduleTimeout?)` returns `true` once a cleanup task fulfills or rejects, and `false` when its deadline wins. Synchronous cleanup and `undefined` complete immediately. A deadline stops waiting; it does not cancel the task. Late rejections stay handled. The helper cancels its timer after the wait.

The optional scheduler takes a callback and a duration and returns a cancellation function. The player engine supplies its engine scheduler so characterization tests continue to use virtual time. Other callers use host timers by default.

## CLI startup

`isCLIEntryPoint(() => import.meta.url, options?)` checks the process entry file and rejects worker-thread startup. Reading the module URL inside the callback lets the helper handle unavailable `import.meta` in SEA/CJS bundles. `allowExecutableFallback: true` permits a match against `process.execPath` only when the module URL cannot be used. A usable module URL that names another file never activates this fallback.

## Existing numeric helpers

Reuse `normalizeASCIIBase36Code` for ASCII validation and case folding, and `clamp` for ordinary closed bounds. Keep format-specific validation, rounding and exclusive upper bounds in the owning package. Skin authors can use the same `clamp` through `@be-music/player-skin-sdk`, preserving the skin SDK import contract. PCM writers use the existing `floatToInt16` conversion.
