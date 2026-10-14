---
'@be-music/chart': minor
---

Add `countScoredNotes(chart, options)`: how many notes a chart scores (its judged notes without FREE ZONE ones, a long note counting once, as `resolveChart(chart, options).notes` has them) and the play variant that decided FREE ZONE, without timing every note. On 5,537 real charts it gives the same counts and variants as `resolveChart` in about 60% of the time.
