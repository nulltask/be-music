---
'@be-music/player': minor
---

Let the play tempo change during a play. A host sends `{ kind: 'tempo', tempo }` as an input command (manual and auto play): the engine re-anchors its clock at the chart time it drains the command, so chart time stays continuous and runs at the new tempo from then on, records the change in the play log (`play.tempoChanges`), calls the new `AudioSession.setTempo` so the audio backend can follow, and reports it through `PlayerOptions.onTempoChange`. Judgments and inputs stay in chart time, so a re-simulated log gives the same result. A replay follows its log's changes through `PlayerOptions.replayTempoChanges`. The new `createTempoClock` maps the play clock to chart time across tempo changes.
