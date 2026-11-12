---
'@be-music/skin-beatoraja': minor
---

Find a sound set's guide sounds, and fix the sign of the judge timing number.

- Find a sound set's guide sounds (`guide-pg` to `guide-ms`, in `sound/` then `defaultsound/`) with `discoverBeatorajaSystemSoundPaths`.
- A beatoraja skin's judge timing number (525) read with the wrong sign: it is now positive for an early press, as beatoraja's `getRecentJudgeTiming` is.
- beatoraja skins draw the corrected LR2 HAZARD gauge as HAZARD.
- The RANDOM slot of the `option1p` / `option2p` buttons steps the shared RANDOM, now one option for every source.
