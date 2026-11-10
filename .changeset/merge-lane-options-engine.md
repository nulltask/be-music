---
'@be-music/player-engine': minor
---

RANDOM is no longer a source-qualified option: LR2, beatoraja and AC all shuffle the keys once for the whole chart, so it is one bare value, and AC's S-RANDOM resolves to LR2's (`lr2:S-RANDOM`), which places notes the same way. Older values `lr2:RANDOM`, `beatoraja:RANDOM`, `____:RANDOM` and `____:S-RANDOM` still resolve, through the new `canonicalOptionValue`; the new `optionValueSources` names the sources a value belongs to (`lr2:S-RANDOM` is LR2's and AC's).
