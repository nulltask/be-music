---
'@be-music/chart': patch
---

Fingerprint charts with control flow with less repeated work: a branch's run of lines is gathered and appended once instead of copying the path line by line (quadratic in a branch holding a whole chart), each factor's common delta reuses the keys of the top-level items instead of keying the whole chart again, and the note resolver no longer builds a BPM / STOP timing resolver for every lane set of every outcome, since the fingerprint reads positions only. The heaviest `#RANDOM` charts tried went from about 120 to 107 ms, and the fingerprints over 5,537 charts from 6.1 to 5.6 s (chart) and 4.7 to 4.4 s (play). The fingerprints are unchanged (checked on those charts and 900 generated `#RANDOM`-heavy ones against the previous implementation).
