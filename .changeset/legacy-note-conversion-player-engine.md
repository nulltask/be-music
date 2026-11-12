---
'@be-music/player-engine': patch
---

LEGACY NOTE on a chart without charge notes or backspin scratches is no longer classified as an assist, and LN REMOVE that removed long notes is now classified as one: live plays record `play.longNoteModifierChangeCount` for LEGACY NOTE and LN REMOVE, which until now was stored only for the long-note additions. A LEGACY NOTE replay without the count still reads as assisted.
