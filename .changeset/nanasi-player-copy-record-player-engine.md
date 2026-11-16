---
'@be-music/player-engine': minor
---

A play of the player's own nanasigroove NOTES COPY or DBLCOPY that copied the chart is now classified `no-save` (source `be-music`, `nanasi-notes:COPY` / `nanasi-notes:DBLCOPY`), since a record is of the chart's own key mode; a chart's own COPY and the player's DOUBLE, GOOD2BAD / GREAT2BAD and HELLJUDGE are unchanged. The replay records the player's options apart from the chart's in `play.playerChartPlayOptions`, which must match `chart.chartPlayOptions`, and `PlannedPlay` takes them so the planned record policy names the COPY as conditional.
