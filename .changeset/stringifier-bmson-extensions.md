---
'@be-music/stringifier': minor
---

Write two more bmson extensions:

- `stringifyBmson` writes a 24 / 48 KEY chart without a `mode_hint` as `keyboard-24k` / `keyboard-24k-double` and gives every lane, the wheel included, its fixed `x` in that layout, so keyboard charts round-trip onto the same lanes instead of being renumbered from `x` 1.
- beatoraja's `scroll_events`: a bmson chart re-emits its preserved list, and the regenerated output, BMS → bmson conversion included, writes each `SC` object with its `#SCROLLxx` rate, where SCROLL used to be dropped. bmson → BMS writes `scroll_events` as `#SCROLLxx` and `SC` objects.
