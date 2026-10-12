---
'@be-music/parser': minor
---

Read the beatoraja bmson extension `scroll_events` (`{ y, rate }`), which was ignored, so bmson SCROLL gimmicks played at a constant scroll speed. Each event becomes a `#SCROLL` change (channel `SC`, one `bms.scroll` key per distinct rate) that holds until the next scroll event, as in BMS; of several events on one pulse the last one wins, as in beatoraja. The authored list is kept in `preservation.bmson.scrollEvents`.
