---
'@be-music/parser': minor
---

Support the bmson `keyboard-24k` / `keyboard-24k-double` mode hints: `x` 1-24 map onto the 24-key bank (`11..19`, `1A..1O`) and `x` 25 / 26 onto the wheel up / down (`1P` / `1Q`), with the double layout repeating that on the 2P side from `x` 27. Keyboard charts used to fall through to the positional fallback, which compacted unused `x` values and put notes on the wrong keys. `key_channels` mines follow the same map. BmsONE's single-player `keyboard-48k` is deliberately not aliased to the double layout.
