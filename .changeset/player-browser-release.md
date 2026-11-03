---
'@be-music/player-browser': minor
---

Add configurable screen controls and improve built-in skin rendering and playback.

- Expose control buttons and per-screen action definitions through the host entry, including `CONTROL_KEY_CONFIG`, `CONTROL_ACTION_IDS`, `CONTROL_ACTIONS`, `effectiveControlKey`, `resolveControlButtons`, `resolveControlScheme`, `controlActionKeys`, and `resolveControlActions`. Accept lane overrides, START / SELECT bindings, built-in control schemes, and action-key overrides; match keyboard operations by physical key and give chart lanes precedence during play.
- Support LR2 and beatoraja controls across select, decide, play, and result screens, including held option panels, difficulty switching, replay selection, quick retry, hi-speed, lane covers, visible time, skin adjustment, and AUTO playback speed controls.
- Add select-screen host events for exit confirmation, folder reload, chart hash copying, folder AUTO play, rankings, and chart difficulty and level edits. Export `dropEntries` and `readDropEntries` for re-reading dropped folders, plus `keyboardEventToTokens` and `PLAY_SCENE_KEY_CODES` for host key configuration.
- Record physical keyboard codes and touch input in replays so touch presses are distinguishable from keyboard presses.
- Draw side-playfield ghosts and independent second players in a two-player cabinet layout with the BGA between the lane banks and separate HUDs, instead of treating the ghost as a double-play chart.
- Give built-in notes, long-note caps, and mines a consistent height based on the playfield's white-key lane width, including scratch and black-key notes.
- Remove spikes and blotches from result graphs by thinning near-duplicate samples and using round joins.
- Reduce HUD text rasterization by reusing text textures and quantizing animated text colors.
- Fix blank WebGPU stages on Safari by keeping multisampled render textures stored, avoiding oversized buffer limits, and preserving PixiJS device-loss recovery.
- Match chart-preview volume to gameplay, including `#VOLWAV`. Fade fallback previews out at the end of their window and fade failed-play audio with the closing animation.
- Require GPU rendering, Web Audio, and drag and drop in `checkBrowserCompat`; report WebAssembly, Workers, and other optional browser capabilities separately.
- Simplify Synesthesia's select card and keep its gameplay progress indicator visible in front of the lanes.
