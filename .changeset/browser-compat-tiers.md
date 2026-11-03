---
'@be-music/player-browser': patch
---

`checkBrowserCompat` now requires only what the player cannot start without: a GPU (WebGPU or WebGL2, one `gpu` item in place of `webgl2`), Web Audio and drag and drop. WebAssembly and Workers become optional, since only legacy BGA video, keep-pitch tempo and off-page parsing need them, and the report adds AudioWorklet, cross-origin isolation, Web Crypto, IndexedDB, Compression Streams and Service Worker as optional items.
