---
'@be-music/chart-model': minor
---

`ResolvedNote.chainSounds` lists the LRX chain notes tied to a judged note: each one that follows it on its lane before the lane's next note, with its delay from the note (`ResolvedChainSound`, exported). The chain notes stay in the background sample triggers, at their own times. `playsAtKeysoundVolume` says whether a sound plays at the keysound volume: a play lane's, or an LRX background sound flagged `keyVolume`.
