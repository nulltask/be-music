---
'@be-music/stringifier': minor
---

`stringifyBmson` writes a 24 / 48 KEY chart without a `mode_hint` as `keyboard-24k` / `keyboard-24k-double` and gives every lane, the wheel included, its fixed `x` in that layout, so keyboard charts round-trip onto the same lanes instead of being renumbered from `x` 1.
