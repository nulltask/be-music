---
'@be-music/player-browser': minor
---

Add replay slots to the result and select scenes: `createResultScene` takes `replaySlots` and `on.saveReplay` (keys 1-4, a beatoraja skin's replay buttons), `SelectRecords.replaySlots` lets the select screen pick a slot (beatoraja's 4 / F / V keys and replay buttons) and hand it to `on.start` as `replaySlot`, `SelectScene.replay(slot)` replays one, and `on.focus` reports the bar under the cursor. A result now stops its jingle and plays the theme's `resultclose` / `course_close` sound as it starts to fade out.
