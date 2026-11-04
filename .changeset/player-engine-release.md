---
'@be-music/player-engine': minor
---

Add configurable lane bindings and physical-input replay metadata.

- Accept `LaneModeOptions.laneKeys` in lane preparation and 7-to-9-key conversion. Export `LANE_KEY_CONFIG`, `laneKeyLabel`, and their types so hosts can build key configuration screens for 5 / 7 / 10 / 14 KEY and 9 KEY layouts.
- Include Space in the default 1P scratch input tokens alongside Left Ctrl; hosts retain ownership of pause shortcuts.
- Accept an optional `code` on lane-input and key-state commands and preserve it on replay input events. Record START / SELECT through the new `control-input` command and `play.controlInputs`.
- Keep physical-input metadata diagnostic: replay simulation and rejudging ignore it, and older replays without it remain readable.
