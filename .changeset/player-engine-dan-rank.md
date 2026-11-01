---
'@be-music/player-engine': minor
---

Add the player's dan rank to `@be-music/player-engine/records`, so a host can keep the highest dan cleared per key mode:

- `DAN_RANKS`, `DanRank`, `isDanRank`, `danRankOrder` and `higherDanRank` define be-music's dan ladder, from 十級 through 初段 … 十段, 中伝, 皆伝 and the 発狂 dans up to Overjoy.
- `resolveCourseDanRank` reads the dan a course certifies from its name, and `formatDanRank` names a rank the same way.
- `resolveCourseRunDanRank` grants that dan only for a cleared GRADE course, and `resolveDanCourseKeyMode` picks the key mode it counts for.
