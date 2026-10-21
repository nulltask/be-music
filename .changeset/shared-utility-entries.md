---
'@be-music/shared-utils': minor
---

Add `./hash` for synchronous and Web Crypto SHA-256, `./async` for cleanup deadlines with an injectable scheduler, and Node-only `./cli` for main-module detection with optional SEA fallback. Cleanup waits cancel their timeout after settling, and the PCM writers reuse the shared float-to-PCM conversion.
