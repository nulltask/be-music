---
'@be-music/parser': patch
---

Fix bmson charts loading notes onto other lanes than beatoraja puts them:

- `beat-5k` / `beat-10k` read the scratch from `x` 6 (and the `beat-10k` 2P side from `x` 7–12), so such charts lost their scratch notes and shifted the 2P side: the scratch is now on `x` 8 (2P keys on `x` 9–13, 2P scratch on `x` 16), as the bmson spec says, and `x` 6 / 7 (14 / 15) have no lane and play as BGM.
- A chart with an unknown `mode_hint` was numbered in order onto `11`, `12`, …, so `x` 6 / 7 / 8 became `16` / `17` / `18` instead of the 6th / 7th keys and the scratch: when every `x` in use fits the `beat-7k` table it is now read as `beat-7k`, as beatoraja, Qwilight and Bemuse read it. A chart with lanes past `x` 8 (BmsONE's keyboard hints) keeps the ordered numbering, now counting the lanes its mines and hidden notes use, so no lane turns into BGM and no mine is dropped.
- A note whose `x` is outside the `mode_hint` lane table (for example `x` 9 under `beat-7k`) landed on lane 1 as an extra playable note: it is now a BGM note.
- `key_channels` were read as mines and `mine_channels` were ignored, so a beatoraja chart lost its mines and turned its hidden notes into mines: `mine_channels` now become mines (`Dx` / `Ex`) that keep their `damage`, and `key_channels` become hidden notes, read as invisible objects (`3x` / `4x`) that only set the lane's keysound. Both use the `mode_hint` lane map, the keyboard layouts included, and their WAVs are numbered after the sound channels in beatoraja's order (`key_channels`, then `mine_channels`).
- A negative `resolution` fell back to 240: it is now read as its absolute value, as the bmson 1.0.0 spec says, so notes keep their authored spacing.
