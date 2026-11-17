---
'@be-music/app-play': patch
---

Difficulty tables now import from sites that send no CORS headers: the course import fetches a table on another origin through the player's same-origin proxy, as `?music=` archives are. Until a list is stored, the player also imports well-known tables whose headers list courses (NEW GENERATION normal and insane, Satellite, Stella, DP Satellite, Stardust, Starlight and Luminous); a table imported by URL is stored after them.
