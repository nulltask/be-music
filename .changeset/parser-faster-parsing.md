---
'@be-music/parser': patch
---

Parse BMS charts faster; the parsed charts and the detected encodings are unchanged (checked on 5,537 real charts):

- About 20% faster parsing: each object line used to be tokenized twice (once for the preserved line, once for the chart's events), and every event was rebuilt and re-normalized before the final sort. Lines are now tokenized once and the events only sorted.
- About 3x faster encoding detection for a file without a BOM or `#CHARSET` that is neither ASCII, valid UTF-8 nor EUC-KR: `decodeBmsText` used to decode and score the whole file once per candidate encoding; lines made only of ASCII bytes are now counted once, and only the lines holding a non-ASCII byte are decoded per candidate. The `#CHARSET` scan reads only the first 4 KB.
