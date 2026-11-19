---
'@be-music/chart-parser': patch
---

Speed up everything that compares or walks a parsed chart's events, such as sorting and timing: events read from BMS, bmson and Be-Music JSON now share the object shapes of the parser's plain events again. Optional fields such as `bmsLineOrder` and `bmson` were spread in, which gave the events several hidden classes and made event comparisons up to three times slower.
