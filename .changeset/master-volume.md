---
'@be-music/player-web': minor
---

Add a master volume over every sound the player makes — gameplay keysounds and BGM, select BGM, chart previews and system sounds, result BGM, and theme sounds. `setMasterVolume` / `getMasterVolume` set and read it (linear, 0..2), and every audible path now ends in `masterOutput(context)`, a per-context gain at that level. The gameplay recorder taps the mix before it, so recordings keep their level whatever the listening volume.
