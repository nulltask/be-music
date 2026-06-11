---
'@be-music/parser': patch
---

`decodeBmsText` now implements the full documented encoding-detection pipeline: UTF-16LE / UTF-16BE BOMs are recognized (such charts previously decoded as garbled shift_jis and lost every event), BOM-less files that strictly validate as UTF-8 decode as UTF-8, and remaining files are scored across shift_jis / utf-8 / euc-jp / iso-8859-1 instead of unconditionally falling back to shift_jis.
