---
'@be-music/player-web': patch
---

Disconnect each per-source `GainNode` from the Web Audio graph as soon as its `BufferSourceNode` ends, so long sessions no longer leak nodes that the audio session's `dispose()` would have to chase down on shutdown.
