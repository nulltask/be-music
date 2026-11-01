---
'@be-music/skin-beatoraja': minor
---

A play skin's judgment and combo display can now be hidden: every `judge[]` image and combo digit is gated on a new synthetic op, `BEATORAJA_OP.JUDGE_DISPLAY_HIDDEN`, which `resolveBeatorajaJudgeDisplayOps` lights while the play runs LR2 SILENT automatic judge timing (LR2 shows no NOWJUDGE / NOWCOMBO there).
