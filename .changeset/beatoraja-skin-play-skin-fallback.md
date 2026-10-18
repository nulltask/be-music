---
'@be-music/beatoraja-skin': minor
---

Add `pickBeatorajaPlaySkinVariant(playSkins, desired)`, which returns the variant whose skin plays a chart instead of its entry, so a host can tell when a theme without the chart's own variant falls back to another.

Fix `pickBeatorajaPlaySkin` falling back in a different order from the web player, which kept a fallback list of its own: a 14 KEY chart tried the 24 KEY DP keyboard skin before the 7, 10, 5 and 9 KEY ones, and a keyboard chart tried the 14 KEY skin before the 9 KEY one. Both now use one list. As in beatoraja, which offers an LR2 7 KEY / 14 KEY skin for 5 KEY / 10 KEY, a 5 KEY chart tries the 7 KEY skin first and a 10 KEY chart the 14 KEY one; an IIDX or POPN chart tries the IIDX and POPN skins before the keyboard ones, and a keyboard chart tries the other keyboard skin first.
