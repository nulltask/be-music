[Japanese version](./0011-host-provided-audio.ja.md)

# Hosts provide audio implementations

`@be-music/player-engine` uses a host-provided `AudioSession`. Node hosts install `@be-music/player-node-audio` through `createAudioSession`; browser hosts install their Web Audio session. The terminal configures the Node adapter automatically. Omitting the factory or returning `undefined` means silent playback.

The Node adapter owns sample decoding through `@be-music/chart-audio-renderer`, realtime mixing, and `node-web-audio-api` output. It receives the engine's `ResolvedChart` so sample slices, timing and source-event identity agree with judgment. It imports the engine only for types. Diagnostic sample-duration loading also comes from the host, because debug output must not make the engine load a decoder.

Keeping automatic Node fallback would preserve the old direct-call behavior but retain Node dependencies in every engine installation. Moving only the PCM sink would leave the renderer dependency and diagnostic decoding in the engine. We move the whole Node audio implementation instead. Node library users must explicitly configure the adapter, and PCM sink imports move to `@be-music/player-node-audio/audio-sink`. A separate shared decoder package can wait until more consumers need its interface.
