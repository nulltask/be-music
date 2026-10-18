---
'@be-music/player-web-demo': minor
---

Play LR2 and beatoraja courses on every skin family: dropped `.lr2crs` and beatoraja course files, beatoraja random courses, and a difficulty table's courses, imported from its URL or from its dropped `header.json` when the table's site blocks the import.

- A course starts from its bar, PLAY or AUTO. AUTO plays every stage on autoplay and, as LR2 does, skips the results of the stages the course goes on after. The decide screen shows once before the first stage, named after the course; backing out of it drops the course. After the course the cursor returns to the course bar.
- A course given up with ESC is kept as a failed run: the stage left is recorded, the course result shows, and the run is saved like any failed course.
- Stages follow the course's constraints: its lane-option constraint applies to both sides and DP FLIP, as beatoraja's `MusicSelector` does (`grade` turns them off, `grade_mirror` plays 2P on MIRROR with FLIP), and an LR2 GRADE course locks the options as LR2 does (an EASY gauge pick plays on GROOVE; HIDDEN / SUDDEN, auto scratch, DP FLIP and the tempo are off), leaving the player's settings for after the course.
- The course result draws its gauge and score graphs (the last stage's on LR2 and built-in skins, every stage joined on beatoraja skins, as each player does), reads SCORE on the stage results' scale and PLAY TIME over the stages played, and is headed COURSE CLEAR / COURSE FAILED on the built-in skins.
- A course run keeps a best record, shown as the course bar's lamp and the built-in card's trophy; an auto-played run keeps none. An EXPERT / GRADE stage also updates its chart's best EX score, max combo, BP and FULL COMBO lamp, as LR2 does, but not its clear lamp or play count.
- The status line says why a course with a stage missing does not start, and that a dropped `.lr2crs` of more than five stages is read as its first five. A course file dropped again replaces its folder instead of adding a duplicate.
- The Debug Menu's Course folder holds Skip stage results, My courses…, NONSTOP placement and the difficulty-table import.
