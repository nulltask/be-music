---
'@be-music/player-web': patch
---

A beatoraja play skin's looping Lua sound (`main_state.audio_loop`) went on playing over the result and the select screen after the play left, since nothing stopped the sounds the play owned. The play scene now plays the skin's sounds as its scene session's and stops them (`AudioService.stopOwned`) as the scene leaves the stage; the play's own audio graph keeps its owner, so a play that ended still rings out.
