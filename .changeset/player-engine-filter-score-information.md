---
'@be-music/player-engine': minor
---

Random-course filters read beatoraja's `score.` and `information.` columns: `CourseChartRecord` takes a `score` row (the best record: `clear` in beatoraja's numbering, `exscore`, `combo`, `minbp`, `playcount`, `notes`) and an `information` row (`n`, `ln`, `s`, `ls`, `total`, `density`, `peakdensity`, `enddensity`, `mainbpm`), and a chart without one reads NULL in its columns as beatoraja's outer join gives. A column only one table has can go unqualified (`playcount > 0 ORDER BY playcount DESC LIMIT 10` now parses), and columns be-music has no source for (`scorelog.*`, `score.epg`, …) stay unknown columns. New `beatorajaClearType` and `createCourseChartScore` map a best record onto the `score` row. Column expressions now carry their `table`.
