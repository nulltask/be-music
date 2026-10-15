---
'@be-music/player-web-demo': patch
---

Stop a beatoraja course stage from playing or graphing another chart. The chart kept between the beatoraja decide, play and result screens was saved under the previous chart's path when a play of a different chart ended, so a later stage of that chart could play the wrong notes and its result showed the wrong BPM graph; a course stage could also reuse a chart resolved without the course's long-note rule. The chart is now saved under the path it was prepared for, and a course stage always resolves its own.
