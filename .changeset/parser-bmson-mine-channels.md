---
'@be-music/parser': patch
---

Fix bmson mines being read from the wrong beatoraja extension: `key_channels` were read as mines and `mine_channels` were ignored, so a beatoraja chart lost its mines and turned its hidden notes into mines. As in beatoraja, `mine_channels` now become mines (`Dx` / `Ex`) that keep their `damage`, and `key_channels` become hidden notes, read as invisible objects (`3x` / `4x`) that only set the lane's keysound. Both use the `mode_hint` lane map, the keyboard layouts included, and their WAVs are numbered after the sound channels in beatoraja's order (`key_channels`, then `mine_channels`). Under an unknown `mode_hint`, the positional lane numbering now counts the lanes these notes use, so a mine on a lane without playable notes is no longer dropped.
