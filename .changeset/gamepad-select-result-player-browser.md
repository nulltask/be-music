---
'@be-music/player-browser': minor
---

Read gamepads on the select, decide and result screens, so a chart can be picked, played and left with a pad alone. Each pad button is the control button it is in the play (a key, a turntable direction) plus START and SELECT, and the screen reads it by its skin family's key map: LR2's turntable down and white keys, beatoraja's turntable up and key 1. A standard pad's Start / Back are START / SELECT and its D-pad is the arrow keys on these screens; an IIDX controller's START / SELECT are E1 / E2. A held turntable or D-pad repeats. The play's pad input is unchanged. `STANDARD_GAMEPAD_MENU_BUTTONS` and `IIDX_GAMEPAD_MENU_BUTTONS` are exported from `./host` for key guides.
