---
'@be-music/app-play': patch
---

Give Synesthesia a decide screen, and lead a RANDOM MIX result back to the select screen.

- Start loading the play the moment a chart is picked on the select screen, when a decide screen follows, instead of after the select screen's launch animation, so the wait before the play is shorter.
- Hide the site header as soon as a chart is picked instead of when the decide screen appears, so the stage no longer jumps in size in the middle of the launch animation in a window.
- A RANDOM MIX's result now always leads back to the select screen. With Loops above 1 or Infinity in the RANDOM MIX dialog, a key on the result started the next run instead, and on AUTO its decide screen went straight on into the play, so there was no way back to the select screen. The dialog no longer asks for Loops: each RANDOM MIX is one draw, and deciding the bar again draws a new one.
