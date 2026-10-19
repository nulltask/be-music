---
'@be-music/lr2-skin': minor
---

Add `@be-music/lr2-skin/ids`, LR2's skin vocabulary as named, documented tables checked against OpenLR2, so hosts and the beatoraja skin package stop keeping their own numbers:

- `LR2_OP`: the ops (`dst_option`) by screen, from the selected bar (1-5, `FOLDER_BAR` on a folder) and the option panels (`NO_PANEL` 20, `PANEL1`-`PANEL9` 21-29) through the play options, chart, gauge, judgement, course (280-293), result rank and course-maker (571-599, 700-745) ops.
- `LR2_TIMER`, `LR2_LANE_TIMER_BANK_SIZE` and `LR2_LANE_INDEX_MAX`: the timers, with the lane banks (bomb, long-note hold, key on / off) as their scratch timer.
- `LR2_NUM`, `LR2_TEXT`, `LR2_BUTTON` and `LR2_SLIDER`: the numbers, texts, buttons (the course-maker ones included) and slider types, named for what LR2 draws there (`LR2_TEXT.TAG` / `TAG_ALT` on 16 / 26, `LR2_NUM.NEXT_RANK_DIFF_ALT` on 109).
- `LR2_BAR_BODY` / `LR2_BAR_BODY_KINDS` and `LR2_BAR_LAMP` / `LR2_BAR_LAMP_KINDS`: the `#SRC_BAR_BODY` and `#SRC_BAR_LAMP` indices and their parsed kinds.
- `LR2_GR`: the runtime-bound image ids (STAGEFILE, BACKBMP, BANNER, …).
