---
'@be-music/player-engine': minor
---

`@be-music/player-engine/records` adds the player's dan rank: `DAN_RANKS` (十級 … 皆伝, 発狂初段 … 発狂皆伝, Overjoy), `recognizeDanRank` to read the rank a course's name names, `formatDanRank`, `danRankOrder` / `betterDanRank` / `isDanRank`, `resolveCourseRunDanRank` for the rank a cleared GRADE course earns, and `mergeDanRankRecord` to keep the higher one. Neither LR2 nor beatoraja derives a dan rank from a course clear on the player's side, so the ladder and the name reading are be-music's own (see `docs/course.md`).
