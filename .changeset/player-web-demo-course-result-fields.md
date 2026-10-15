---
'@be-music/player-web-demo': patch
---

Fix the built-in and LR2 course / NONSTOP results showing the EX score as SCORE (72 where the stage results read 200000) and a PLAY TIME of `0.0s`: SCORE now reads on the stage results' scale (LR2's 200000-point score over the course's notes, else the EX score), PLAY TIME adds up the stages played (a stage given up counts up to where it was left; a NONSTOP run takes its stitched play's), and an EXPERT / GRADE course result is marked `courseResult`, so the built-in skins head it `COURSE CLEAR` / `COURSE FAILED`.
