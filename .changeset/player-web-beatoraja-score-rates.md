---
'@be-music/player-web': patch
---

Fix the score rates on beatoraja play and result skins: 102 / 103 drew the EX score over every note and 115 / 116 the displayed score's ratio. They now follow beatoraja's `ScoreDataProperty`: during a play 102 / 103 are the EX score over the notes judged so far (100 % before the first) and 115 / 116 the EX score over every note, and a result draws both over every note. Each is truncated to hundredths of a percent, so an exact 57 % no longer draws as 56.99.
