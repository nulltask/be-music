---
'@be-music/player-web': patch
---

Fix the select list racing ahead on a trackpad or smooth-scrolling mouse: every wheel event moved the cursor one entry, so a light touch flew through the list. Smooth scrolling now moves one entry per row of travel, while a notched wheel still moves one entry per notch. On touch screens the list follows the finger, keeps gliding and slowing down after a swipe, and settles back onto a row when it stops. The built-in skins (Synesthesia, Phantom, Lattice, Plain) draw the rows at the list's pull through the skin SDK's new `listScroll`.
