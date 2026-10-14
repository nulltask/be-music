---
'@be-music/player-web-demo': patch
---

In fullscreen on Chrome / Edge, a short Esc press no longer just leaves fullscreen: the demo locks Escape with the Keyboard Lock API while fullscreen, so Esc quits the play (and runs the other scene actions) as it does windowed, and a long Esc press leaves fullscreen. Browsers without Keyboard Lock (Safari, Firefox) keep the previous behaviour.
