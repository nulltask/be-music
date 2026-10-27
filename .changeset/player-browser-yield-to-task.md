---
'@be-music/player-browser': patch
---

Chart loading no longer waits on clamped timers between tasks: the worker pool's local fallback and the collection loader's progress yields go through `scheduler.yield()` or a `MessageChannel` message instead of `setTimeout(…, 0)`, which nested calls clamp to 4 ms in browsers and 1 ms in Node.
