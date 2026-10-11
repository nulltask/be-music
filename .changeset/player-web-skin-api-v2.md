---
'@be-music/player-web': patch
---

The be-music skin registry accepts skins written for skin API revision 2 as well as revision 1. Skins can change play options and open the readme from the select screen through the new `setPlayOption`, `cyclePlayOption`, and `toggleReadme` actions, and every frame carries the skin's settings resolved to their defaults; the other revision 2 fields are left empty or `undefined` for now. `PixiPlayOptions` and its value unions are now aliases of the SDK's `BeMusicPlayOptions` types.
