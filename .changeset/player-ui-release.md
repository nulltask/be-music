---
'@be-music/player-ui': minor
---

Support consistent note sizing and two-player cabinet presentation.

- Add optional `BeMusicNotesData.whiteLaneWidth`; playfield frames supply it so notes, long-note caps, and mines share a white-key-based height instead of a fixed height.
- Draw independent players and side-playfield ghosts with separate gauges, scores, and hi-speed panels around a central BGA.
- Use round joins for gauge and timing graphs to prevent sharp turns from producing miter spikes.
- Add compact chart details, improve portrait controls and select filters, and keep result information grouped consistently.
- Keep held cabinet keys filled, animate turntable indicators with chart beats and scratch input direction, and vertically center compact gauge captions. Show AUTO PLAY and GHOST PLAY above each side's judgment, including between hits and with LIFT.
