---
'@be-music/player-ui-vue': minor
---

Wrap the chart score element, and follow the README dialog.

- Add the `BeMusicChartScore` wrapper for `<be-music-chart-score>`, with its `layout`, `selection`, `previewing`, `columnBeats`, `beatHeight` and `disabled` props and `onBarSelectionChange`.
- `BeMusicChartScore`'s `previewing` prop takes a run of bars (`{ first, last }`) as well as one bar.
- `BeMusicChartDetails` takes `readmeAvailable` in place of `readText`, following `<be-music-chart-details>`: the README shows in the host's dialog instead of under the buttons.
