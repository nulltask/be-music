---
'@be-music/player': patch
---

AUTO play sent every note's keysound to the audio session twice — once as background audio and once as the note's own keysound — so each note played doubled (louder, and twice for a sample that is not cut on retrigger): it now sends each one once. Background audio is the same in both modes: every sound that is not a play lane's, plus the keysounds of duplicate notes that lost their lane to another note.
