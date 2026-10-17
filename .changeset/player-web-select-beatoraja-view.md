---
'@be-music/player-web': minor
---

`createSelectScene` takes a beatoraja kit (`{ family: 'beatoraja', kit }`, the theme's select entry loaded with `loadBeatorajaSceneKit`): the select session drawn by the beatoraja family view, so every family's select screen is made with it.

- The view draws the skin through `BeatorajaPlaySkinView` and the select mapping of `@be-music/beatoraja-skin/scene`, with the bar list at the skin's `songlist` anchor, the focused chart's images and graphs, and the README overlay. A click on a bar and the skin's buttons come back as intents: PLAY / AUTO / PRACTICE, READ TEXT, the favourites, and MODE and SORT, which step the key filter and the sort of the browse position (Shift steps back). The LNMODE choice stays in the view.
- The session follows the beatoraja select policy: its keys (↑ / ↓, Page Up / Page Down ten bars, Home / End, R for a random bar, Escape backs out and leaves at the root, Backspace backs out of a folder only), the sort and filters kept in the browse position rather than the play options, and the folder cues without the cursor cue.
- Its sound goes through the audio service: the select BGM, the cues, the chart preview and the skin's Lua sounds (`audio.skinSounds.owned`), all stopped as the screen leaves.
- `SelectSceneEvents.skinConfigChange` hands the host the skin's options when its JUDGE TIMING button changes them; `updateKit` takes a beatoraja select entry loaded again.
