---
'@be-music/stringifier': patch
---

Fix `stringifyBmson` moving notes and mines to other lanes on the round trip: a `beat-7k` chart's keys 6 / 7 and scratch (`18` / `19` / `16`) came back on `14` / `15` / `13`, because non-keyboard lanes were numbered from 1 in channel order while the parser reads `mode_hint` through fixed lane tables. Every hint the parser knows (`beat-5k`, `beat-7k`, `beat-10k`, `beat-14k`, `popn-5k`, `popn-9k`) now writes each lane at the `x` the parser maps back to it; unknown hints still number the lanes in use from 1.
A BMS chart without a bmson `mode_hint` now gets its play variant's canonical hint (e.g. `beat-7k` rather than `beat-4k` for a 7 KEY chart using four lanes) when all of its lanes fit that layout, so BMS → bmson exports keep their lanes too.
