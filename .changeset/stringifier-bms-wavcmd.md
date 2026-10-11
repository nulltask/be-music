---
'@be-music/stringifier': patch
---

Fix `stringifyBms` dropping `#WAVCMD` lines: when an edited chart's header is rewritten, every line in `bms.wavCmds` is now written instead of only the first one.
