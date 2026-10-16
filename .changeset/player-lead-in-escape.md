---
'@be-music/player': patch
---

An ESC during the lead-in started a manual play's chart audio at the end of the lead-in before stopping it, and an AUTO play waited the whole lead-in out: both now stop at the ESC, before the chart starts, and record the abort at the chart's start. Commands sent during the lead-in are taken as they arrive in both modes: a tempo or HIGH-SPEED change sets what the chart starts with, a view change is recorded at the chart's start, a pause holds the chart at its start, and lane input is dropped.
