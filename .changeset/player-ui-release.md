---
'@be-music/player-ui': minor
---

Support consistent note sizing and two-player cabinet presentation.

- Add optional `BeMusicNotesData.whiteLaneWidth`; playfield frames supply it so notes, long-note caps, and mines share a white-key-based height instead of a fixed height.
- Draw independent players and side-playfield ghosts with separate gauges, scores, and hi-speed panels around a central BGA.
- Use round joins for gauge and timing graphs to prevent sharp turns from producing miter spikes.
