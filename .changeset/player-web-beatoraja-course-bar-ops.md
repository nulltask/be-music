---
'@be-music/player-web': patch
---

beatoraja select skins lit `OPTION_GRADEBAR` (3) on random-course bars and never lit `OPTION_PLAYABLEBAR` (5) on course bars. As beatoraja's `BooleanPropertyFactory` does, op 3 now lights on fixed course bars only (a random course lights `OPTION_RANDOMCOURSEBAR` alone), and op 5 lights on a course bar that can start.
