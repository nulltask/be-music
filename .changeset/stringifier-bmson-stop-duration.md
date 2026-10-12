---
'@be-music/stringifier': patch
---

Fix `stringifyBmson` writing STOP lengths in BMS `#STOP` units instead of pulses: a BMS chart converted to bmson came back with its stops shortened (a 24-unit STOP, half a beat, played as 0.1 beat at resolution 240). `stop_events[].duration` is now converted to pulses at the output resolution.
