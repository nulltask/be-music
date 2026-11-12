[日本語版](./0041-chart-authored-base-speed.ja.md)

# Treat chart-authored BASE-SPEED as the standard rate

nanasigroove 1.552's legacy `774:CRA-RHS1`, `774:CRA-RHS2` and `774:CRA-RHS3` set rates of 1.2, 1.5 and 2.0 in initial `#OPTION` declarations. The last valid initial declaration wins. `CRAZY_OFF` leaves the rate in force. Channel A6 reports `initial-only-alias` for these IDs. [Reference evidence](../research/chart-authored-options.md) · [#1074](https://github.com/nulltask/be-music/issues/1074)

The browser and terminal multiply the chart rate by the player's tempo. The browser slider limits the player's multiplier. Audio and BGA follow the effective rate, and the browser stretches samples to that rate before playback in keep-pitch mode.

A play at the chart's standard rate follows the ordinary record, lamp and Leaderboard rules. Changing the player tempo makes the play practice. Both fingerprint documents carry `playOptions.baseSpeed` and the replay records it in version 2 of `chart.chartPlayOptions`. `play.tempo` and `play.tempoChanges` measure the player's multiplier relative to the chart rate. Older replays use the program they recorded.

A regular course stage uses the chart's BASE-SPEED. NONSTOP stitches its stages into one play and diagnoses each stage's declaration.
