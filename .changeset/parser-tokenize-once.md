---
'@be-music/parser': patch
---

Parse BMS charts about 20% faster: each object line used to be tokenized twice (once for the preserved line, once for the chart's events), and every event was rebuilt and re-normalized before the final sort although the parser had already built it normalized. Lines are now tokenized once and the events only sorted. The parsed charts are unchanged (checked on 5,537 real charts).
