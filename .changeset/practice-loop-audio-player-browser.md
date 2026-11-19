---
'@be-music/player-browser': patch
---

A PRACTICE loop's first beat sounds whole again: the seek crossfade faded in every sound of the new round, so its on-time sounds started from silence, while the old round's sounds queued past its end still played. Sounds the new position starts on time now play at full volume, only those it starts partway fade in, and queued sounds of the old position do not play.

A PRACTICE play of picked bars decodes only the samples it can sound and loads only the BGA images it can show, so it starts faster on a long chart. A bar audition at a kept-pitch tempo stretches only the part of a long sample the bar sounds, instead of the whole file, skips the samples that finished before the bar, and sends what it stretches to the stretcher in one batch. `AudioServicePreview.prepareWindows` stretches what each bar of a chart sounds in the background, nearest the bars picked first, so later bars sound at once; a bar played meanwhile goes ahead of it.
