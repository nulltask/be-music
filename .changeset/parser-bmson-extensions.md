---
'@be-music/parser': minor
---

Read two more bmson extensions:

- The `keyboard-24k` / `keyboard-24k-double` mode hints: `x` 1-24 map onto the 24-key bank (`11..19`, `1A..1O`) and `x` 25 / 26 onto the wheel up / down (`1P` / `1Q`), with the double layout repeating that on the 2P side from `x` 27. Keyboard charts used to fall through to the positional fallback, which compacted unused `x` values and put notes on the wrong keys. bmson mines and hidden notes follow the same map. BmsONE's single-player `keyboard-48k` is deliberately not aliased to the double layout.
- beatoraja's `scroll_events` (`{ y, rate }`), which were ignored, so bmson SCROLL gimmicks played at a constant scroll speed. Each event becomes a `#SCROLL` change (channel `SC`, one `bms.scroll` key per distinct rate) that holds until the next scroll event, as in BMS; of several events on one pulse the last one wins, as in beatoraja. The authored list is kept in `preservation.bmson.scrollEvents`.
