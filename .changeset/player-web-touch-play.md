---
'@be-music/player-web': minor
---

The built-in and LR2 play screens can be played on a touch screen, and the select list scrolls with a swipe.

- Each lane is a touch zone from the lower part of the lane down to the bottom of the stage, with gaps between lanes split between neighbours. Every finger presses, holds, and releases its lane independently, and sliding a finger into another lane releases the old lane and presses the new one. Touches are fed to the engine through the same lane-input path as the keyboard, with the pointer event's timestamp, so judgement, long notes, key beams, auto scratch, and play logs behave as with keys. Mouse clicks keep their old behaviour.
- The play scene keeps the page from scrolling or zooming under the fingers (`touch-action: none` on the canvas during play) and lifts every finger when the play pauses.
- `CoreGameplayView` gains `requestTogglePause()`, `isPaused()`, and `requestExit()` (Escape's exit, fade-out included), so a host can offer on-screen pause / quit controls on devices without a keyboard.
- On the select screen a touch acts on lift: a tap picks a row as a click does, and a swipe along the list moves the cursor one entry per row travelled (or pans the open README).
