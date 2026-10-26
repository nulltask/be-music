---
'@be-music/player-browser': minor
---

The select screen's search takes chart filter expressions (`?level >= 12 AND score.clear < 5`), reading each chart's song columns, its best record under the active judge ruleset and its song information. The frame carries `searchError` and the select scene has `searchError()` while the expression does not parse. `createCourseChartRecord` fills the `information` row and takes a best-record reader for the `score` row, and `drawBrowserRandomCourse` takes one too, so random courses can filter by them.
