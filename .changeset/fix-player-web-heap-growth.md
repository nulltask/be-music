---
'@be-music/player-web': patch
---

Cap beatoraja texture decoding at four concurrent jobs through `runWithConcurrency` instead of dispatching every asset in parallel via `Promise.all`. Themes that ship hundreds of bitmaps (the LITONE families, several Hi-Speed packs) used to allocate every decoded `ImageBitmap` plus its backing `ArrayBuffer` at the same time, peaking gameplay heap by several hundred MB before the GC could reclaim the input buffers. The bounded scheduler keeps memory pressure proportional to the worker count.
