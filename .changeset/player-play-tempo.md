---
'@be-music/player': minor
---

Play at another tempo and change it during a play:

- A live play run at another `PlayerOptions.speed` records it as `play.tempo` (absent = 1), and `parsePlaylog` reads it back, so a replay can play back at the tempo it was played at.
- A host changes the tempo during a play with a `{ kind: 'tempo', tempo }` input command, in manual and auto play. The engine re-anchors its clock at the chart time it drains the command, so chart time stays continuous and runs at the new tempo from then on, records the change (`play.tempoChanges`, every change after `play.tempo`), calls the new `AudioSession.setTempo` so the audio backend can follow, and reports it through `PlayerOptions.onTempoChange`. `createTempoClock` maps the play clock to chart time across tempo changes.
- A replay (`replayInputs` set, in either mode) follows its log's changes through `PlayerOptions.replayTempoChanges` and records neither `play.tempo` nor `play.tempoChanges`, since a replay's speed only sets how fast it is re-driven. A live play ignores `replayTempoChanges`, so a host replaying an AUTO-played log passes its (empty) inputs as `replayInputs` next to them.

Inputs and judgments stay in chart time, so a re-simulated log gives the same result at any tempo. `playedAtAnotherTempo` tells whether a log ran at another tempo at any point, and the eligibility checks refuse such a play.
