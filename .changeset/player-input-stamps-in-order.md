---
'@be-music/player': patch
---

A short tap no longer records its release before its press in the play log. The engine stamps each press and release by the playback clock when it drains it, moved back by the age of the event's `pressedAt`; the playback clock follows the audio clock, which moves a render quantum at a time, so a release drained just after its press read a few hundred µs older than it. A replay and the play-log simulators then read the release first and held the lane down after the tap, setting off its mines and holding a long note tapped that way. The engine now stamps each input no earlier than the one it drained before, so the log is in order and the live play, its replay and the simulators agree.
