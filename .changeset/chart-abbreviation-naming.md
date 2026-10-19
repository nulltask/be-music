---
'@be-music/chart': minor
---

Rename acronym-bearing exports and fields, including BMS, BGA, BPM, and JSON names, with only the last consecutive abbreviation uppercase. Rename the canonical fingerprint document key `baseBpm` to `baseBPM`; this deliberately changes existing development `bmfp0` values and requires recomputing stored chart, play, and dependent course fingerprints.
