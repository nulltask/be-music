---
'@be-music/player-web-demo': patch
---

Extract the pure family-dispatch derivations (`availableFamiliesForScene`, `pickActiveFamilyForScene`, `hasAnyLr2Skin`) out of the demo's `PlayerWebDemoApp` god-class into a standalone `family-dispatch.ts` module that consumes a `FamilyDispatchState` snapshot. No behaviour change; the demo class trims by ~60 lines.
