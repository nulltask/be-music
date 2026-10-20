[日本語版](./0007-one-system-audio-context.ja.md)

# System sounds share one AudioContext; each play keeps its own

In the web player, every sound outside a play's chart goes through one **audio service** (`createAudioService` in `@be-music/player-browser/audio`), on one system `AudioContext` created on first use. That covers the select BGM, the select cues, the decide and result jingles, the chart preview and a beatoraja skin's Lua sounds. Each sound is decoded once per bytes. A play still opens its own `interactive` context and audio bus, through the same service (`openPlayGraph`). A play starts hundreds of sources a second through its compressors and needs the lowest key-to-sound latency. Closing its own context ends every sample at once, after the tail has rung out. A scene used to silence its sounds by closing its context; with a shared context that stop is explicit. Each scene passes itself as the **owner** of what it starts and calls `stopOwned` on exit.

We chose this because the scenes had grown seven contexts of their own:

- the built-in / LR2 select screen;
- the result jingle;
- the beatoraja decide and result BGM;
- the beatoraja skin sounds;
- the beatoraja select preview;
- the beatoraja chart preparation;
- one per play.

Safari allows only a few contexts at once. Each scene decoded its sounds again on every entry. The master volume, the preview ducking and the select BGM level were wired in several places and had drifted: the built-in select ducked its BGM under the preview, the beatoraja one did not.

## Considered options

- **A context per scene, as before.** Closing it stops everything the scene started, with no bookkeeping. But it keeps the seven contexts, the repeated decodes and the routing wired in each scene.
- **One context for everything, the play included.** The fewest contexts. But a play's latency hint, bus and teardown would be shared with the select screen's sounds. Ending a play could no longer drop its whole graph with one `close()`, so every one of its sources would need its own stop. We may revisit this once the play graph tears itself down node by node.
- **Suspend or close the shared context on a scene exit.** It would also stop what the next scene has started, such as the decide cue that plays as the select screen leaves.
