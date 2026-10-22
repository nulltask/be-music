---
'@be-music/player-engine': minor
---

AUTO play can start partway with `startAtSeconds`, as a preview's seek bar needs: the clock starts at that chart second, the notes before it count as AUTO judged them without their effects, the volume changes before it apply, and sounds still ringing there start partway through the audio session's new optional `triggerEventAt(event, offsetSeconds)`.
