---
'@be-music/player-ui': minor
---

Add preview components: `be-music-playback-controls` (play / pause, seek bar, time, mute and volume, full screen), `be-music-preview-hud` (a centred play button while paused, and its controls hidden while the host sets `controlsHidden`), `be-music-preview-select` and `be-music-preview-start`, with the `seek-request`, `volume-change` and `fullscreen-request` events the `formatPlaybackTime`, `resolveSeekTarget` and `resolveGameplayPanels` helpers, and the preview layout (`resolvePreviewBGARect`, `resolvePreviewInfoBox`): the largest BGA right of the lanes and above the controls, with the chart's facts beside or under it.
