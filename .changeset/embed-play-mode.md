---
'@be-music/app-play': minor
---

The embed can now let the viewer play a chart instead of only previewing it: add `mode=play` to `/embed/?track=…` to play with the default lane keys, judged as a normal play without seeking. While playing, M and F are lanes, so the mute and full-screen shortcuts apply only before the play starts. `mode=preview` or no `mode` keeps the AUTO preview. Neither mode records a replay or score.
