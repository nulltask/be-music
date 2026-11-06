---
'@be-music/player-ui': minor
---

Add a chart score element and a README dialog.

- Add `<be-music-chart-score>`, which draws a chart as a printed score: its bars in columns, bottom to top, each with its measure number, bar and beat lines, notes, long notes and mines on the play mode's lanes (5 / 7 / 10 / 14 KEY and 9 KEY), and its tempo changes and stops. `layoutChartScore(chart)` lays a resolved chart out bar by bar (measure lengths, BPM changes, stops, long notes across bar lines) with each bar's chart times, and the bars can be picked one or a run at a time (`bar-selection-change`, `chartScoreRangeTimes`). `packChartScoreColumns`, `selectChartScoreBars`, `resolveChartScoreLanes`, `resolveChartScoreColumn` and `chartScoreRowAt` are exported too.
- `layoutChartScore(chart, { omitEmptyFirstBar: true })` leaves an empty measure 0 out so the score starts at measure 1, with `isChartScoreBarEmpty` and each bar's `soundCount` deciding what is empty. `<be-music-chart-score>`'s `previewing` also takes a run of bars (`{ first, last }`) to outline.
- `isChartScoreBarEmpty` (and `omitEmptyFirstBar`) now reads a bar as empty when it holds nothing to play: no note, long note or mine. BGM, BGA, tempo changes and stops in a lead-in measure 0 no longer keep it on the score.
- Add `<be-music-readme-dialog>`, a modal Basecoat dialog that shows a plain text file such as a chart's README in a fixed-width face, with its web and mail addresses as links that open in a new tab (`rel="noopener noreferrer"`). It builds text nodes and anchors from `splitLinkedText`, a new export that splits a text into runs of plain text and links, so the text is never read as HTML. The dialog sends `readme-close` from its close button, Escape and the backdrop, and `scrollTextBy(delta)` scrolls it for a host that takes the keys.
- `<be-music-chart-details>` no longer shows the README inline under its buttons: `readText` is replaced by `readmeAvailable`, which disables the Readme button on a chart without one.
- The play screen's difficulty plate shows an estimated difficulty with its mark (`?` from the names, `??` from the note count) and dimmed, the note-count one further (`data-estimated="names" | "notes"`).
