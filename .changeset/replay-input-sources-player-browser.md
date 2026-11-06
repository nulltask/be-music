---
'@be-music/player-browser': patch
---

Touch lanes now name their input source (one per lane's touch zone) on the commands they send, so replays record it and a back-spin scratch tapped again on the same zone ends as before; each lane's touch release is sent on its own. Replay playback passes the replay's input-source table to the engine.
