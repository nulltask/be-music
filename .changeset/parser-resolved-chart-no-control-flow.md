---
'@be-music/parser': patch
---

Fix a resolved chart rolling `#RANDOM` again when it was resolved a second time: `resolveBmsControlFlow` left `bms.controlFlow` on its result, so resolving it again (as the player engine did with a chart a host had already resolved) added a freshly drawn branch on top of the one applied, doubling notes and keysounds. The result now carries no control flow, so it reads as resolved and resolving it again changes nothing; stringifying it no longer writes the branches back out either.
