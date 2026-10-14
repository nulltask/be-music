---
'@be-music/parser': patch
---

Detect a chart's text encoding about 3x faster. When a file has no BOM, no `#CHARSET` and is neither ASCII, valid UTF-8 nor EUC-KR, `decodeBmsText` used to decode and score the whole file once per candidate encoding. Lines made only of ASCII bytes read the same under every candidate, so they are now counted once, and only the lines holding a non-ASCII byte are decoded per candidate. The chosen encoding and the returned text are unchanged (checked on 5,537 real charts), and the `#CHARSET` scan reads only the first 4 KB it looks at.
