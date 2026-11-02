---
'@be-music/app-play': patch
---

Dropping a ZIP archive onto the player now loads it: an archive that holds a chart is added to the song list, as a `?music=` archive is, and any other archive (a skin, replays, course files) is expanded and read like a dropped folder. Before, a dropped archive was taken for a skin file and its charts never appeared. The archive's entry list is read from its central directory, without inflating its audio, to tell the two apart. Open files sorts archives the same way, so it takes a skin archive too.
