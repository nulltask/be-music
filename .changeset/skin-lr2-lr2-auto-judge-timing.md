---
'@be-music/skin-lr2': minor
---

LR2's automatic judge timing on the select panel: button 75 (`LR2_BUTTON.JUDGE_AUTO_ADJUST`) cycles OFF, ON and SILENT (`LR2_JUDGE_TIMING_AUTO_ADJUST_CYCLE`) and draws that cell, text 80 labels the setting instead of always reading OFF, and number 12 shows the judge timing on the select screen and, from the frame's `judgeTimingMs`, during play instead of 0 (#777).
