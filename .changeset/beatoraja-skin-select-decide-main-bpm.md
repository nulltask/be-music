---
'@be-music/beatoraja-skin': patch
---

Fix the main BPM (number 92) on beatoraja select and decide skins showing the header BPM: `resolveBeatorajaSelectNumber` and `resolveBeatorajaDecideNumber` now read the main BPM a play shows, the BPM the most judged notes sit at, from the new optional `BeatorajaSelectChartFacts.mainBpm` and `BeatorajaDecideInput.mainBpm`, and fall back to the header BPM without one. The other BPM numbers are unchanged.
