---
'@be-music/beatoraja-skin': minor
---

Name more of beatoraja's ids, and take the ones it shares with LR2 from `@be-music/lr2-skin/ids` (now a dependency):

- `BEATORAJA_OP` gains the course-bar constraint ops (`GRADEBAR_CLASS` … `GRADEBAR_HCN`, 1002-1017), the stage ops (`COURSE_STAGE1`-`4`, `COURSE_STAGE_FINAL`), `MODE_COURSE` and `RANDOMCOURSEBAR` (1031, the cursor is on a random-course bar).
- `BEATORAJA_TEXT` gains the course stage-title strings (`COURSE1_TITLE` 150 … `COURSE10_TITLE` 159), and `BEATORAJA_NUM` the select screen's `FOLDER_TOTALSONGS` (300), `TOTALNOTE_*` (350-353), `DENSITY_*` (360-365) and `CLEAR` (370).
- The `BEATORAJA_OP`, `BEATORAJA_NUM`, `BEATORAJA_TEXT` and `BEATORAJA_BUTTON` entries and the `TIMER_*` constants beatoraja shares with LR2 read their value from `LR2_OP` / `LR2_NUM` / `LR2_TEXT` / `LR2_BUTTON` / `LR2_TIMER`, and `LR2_LANE_INDEX_MAX` is re-exported from there. beatoraja's own ids, `BEATORAJA_TEXT.FULLARTIST` (16) among them, are still numbered here. Every existing name and value stays the same.
