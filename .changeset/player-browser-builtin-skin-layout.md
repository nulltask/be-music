---
'@be-music/player-browser': patch
---

Fix the built-in skins' layout:

- The stage canvas now follows its container when the container changes size without a window resize. Plain drew into an 800 px corner of a wide screen and kept its landscape layout on a phone held upright.
- Plain's landscape header no longer draws over the lanes, and its 1P gauge and track line up with the lanes' left edge.
