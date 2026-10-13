---
'@be-music/parser': patch
---

Fix a bmson chart with an unknown `mode_hint` landing on the wrong lanes: its `x` values were numbered in order onto `11`, `12`, …, so `x` 6 / 7 / 8 became `16` / `17` / `18` instead of the 6th / 7th keys and the scratch. When every `x` in use fits the `beat-7k` table, the chart is now read as `beat-7k`, as beatoraja, Qwilight and Bemuse read it. A chart with lanes past `x` 8 (BmsONE's keyboard hints) keeps the ordered numbering, so no lane turns into BGM.
