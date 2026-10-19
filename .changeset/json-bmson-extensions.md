---
'@be-music/json': minor
---

Add the types of beatoraja's bmson extensions:

- `mine_channels`: `BmsonMineNoteEntry` / `BmsonMineChannelEntry`, bmson mines with their `damage`. `BmsonKeyNoteEntry` now documents `key_channels` as beatoraja's hidden notes, and its `l`, `c` and `damage` fields are deprecated because nothing reads them.
- `scroll_events`: `BmsonScrollEventEntry` and the optional `BmsonPreservation.scrollEvents`, which `cloneJson` copies.
