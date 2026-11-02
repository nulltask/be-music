---
'@be-music/app-play': patch
---

PRACTICE is quicker to set up and to repeat:

- Debug Menu's PRACTICE folder shows the note-density graph of the chart under the cursor with a start and an end handle to drag (mouse or touch), so aiming at a passage no longer means guessing millisecond numbers. The handles snap to measure starts, the caption shows the range's times (m:ss.s) and measure numbers, and START TIME / END TIME follow the handles and the other way round. The picker shows only while PRACTICE is on and is disabled during a play like the other PRACTICE settings.
- The play starts one bar before the bar the range starts in and loops one bar after the bar it ends in, instead of 1000 ms on either side, so each loop comes back in time with the music.
- Loops no longer show NOW LOADING: when the range ends, it plays again at once in the same play screen, without decoding the chart's samples again, until ESC.
