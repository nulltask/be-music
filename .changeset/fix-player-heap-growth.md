---
'@be-music/player': patch
---

Drop the engine's bespoke `delayImmediate` cooperative-yield helper and route the sub-8 ms tail-spin through a dedicated `input-wakeup` primitive instead. The previous `setImmediate` / `queueMicrotask` fallback path kept appending continuations to the microtask queue when no input arrived, which dragged the loop's resident heap upward over a long session (visible as creeping `playback-state` RSS growth during multi-song TUI runs). The new wakeup module suspends on the input signal directly so an idle tail-spin holds no closures.
