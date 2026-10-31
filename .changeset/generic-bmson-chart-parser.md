---
'@be-music/chart-parser': patch
---

Use the shared generic lane table for `generic-Nkeys` bmson with 1–70 keys. Out-of-range or malformed `generic-` hints are read as unknown hints (`beat-7k` where the lanes fit, as beatoraja does) instead of clamping them or routing extra columns into unrelated channel families.
