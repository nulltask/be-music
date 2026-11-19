---
'@be-music/player-engine': minor
---

Add `AudioSession.scheduleEventAt(event, outputSeconds)`: a session whose write head (`scheduledSeconds`) runs ahead of its output now gets each realtime sound the engine queues (background sounds, `#xxx97` / `#xxx98` volume changes, AUTO play's keysounds) with its due time on the output clock, so it can start it exactly then instead of on the tick that queued it. Sessions without it are unchanged: those sounds still go through `triggerEvent`.
