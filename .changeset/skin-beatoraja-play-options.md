---
'@be-music/skin-beatoraja': minor
---

Add `resolveBeatorajaOptionButton` and `resolveBeatorajaPlayOptionIndex`: the select screen's option buttons step the play options and their labels read them, as beatoraja does. The RANDOM 1P / 2P buttons (42 / 43) step through beatoraja 0.8.9's ten lane options in its order for the play mode passed in (`BeatorajaOptionButtonMode`: `Random.OPTION_GENERAL`, or `Random.OPTION_PMS` for PMS), and the automatic display-timing button (75) switches the automatic judge-timing mode between OFF and beatoraja's calibration, reading LR2's modes as off (#777).
Report START BPM HS-FIX with beatoraja's original option index, show the judge display timing on number 12, and show the player's LN MODE on the LNMODE image where the chart leaves its long-note mode undefined.
