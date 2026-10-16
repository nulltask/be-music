---
'@be-music/player-web': minor
---

`CoreSongSelectView`, the base of the built-in and LR2 select scenes, and its `CoreSongSelectViewOptions` and `SelectDesignSize` types are removed: the select screens of both families are `createSelectScene`'s, a select session drawn by the family's view. A skin family's select screen is a family view (`SelectView`) over the select session's frames, not a subclass with theme hooks.
