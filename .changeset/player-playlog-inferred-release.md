---
'@be-music/player': minor
---

Add `inferred?: true` to `PlaylogInputEvent`: it marks an `up` the engine inferred because the input reported no key releases (a terminal without the kitty keyboard protocol), at the instant the engine took the key as let go. It is diagnostic only: replays and the simulators read such a release like any other. `parsePlaylog` accepts it on an `up` only, and `PlaylogRecorder.recordInput` takes it as a fifth argument.
