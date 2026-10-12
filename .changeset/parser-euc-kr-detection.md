---
'@be-music/parser': minor
---

Korean charts encoded in EUC-KR now decode as Korean instead of Shift_JIS garbage. `decodeBmsText` reads a BOM-less buffer as EUC-KR when every non-ASCII byte pairs up as KS X 1001 (the probe beatoraja runs before MS932) and at least 90 % of its non-ASCII text is Hangul, and `#CHARSET EUC-KR` / `CP949` is honoured. `DecodedBmsText.encoding` gains `'euc-kr'`.
