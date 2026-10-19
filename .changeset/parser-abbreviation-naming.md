---
'@be-music/parser': minor
---

Rename the BMS parser exports to `parseBMS`, `resolveBMSControlFlow`, and `resolveBMSControlFlowWithDraws`. Emit canonical abbreviation spellings in Be-Music JSON while continuing to accept former IR keys on input, with canonical keys taking precedence; external BMS directives and bmson contract keys stay unchanged.
