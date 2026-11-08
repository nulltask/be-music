[Japanese version](./README.ja.md)

# @be-music/player-node-audio

The host adapter for Node audio sessions, sample decoding and PCM output, used by the engine of [`@be-music/player-engine`](../player-engine/README.md) in Node.

- Host-provided Node audio session, realtime sample mixing, and PCM output through `node-web-audio-api`
- Owns the [`@be-music/chart-audio-renderer`](../chart-audio-renderer/README.md) dependency; `player-engine` imports neither audio rendering nor Node output
- Configure `createAudioSession: createNodeAudioSession` for Node engine calls; the terminal player does this automatically (see [Player spec](../../docs/player-spec.md#node-audio-adapter))
- The `./audio-sink` entry exposes the audio sink (the output behind a session) on its own
