[日本語版](./README.ja.md)

# Architecture decisions

Decisions that shape the code and would be costly to reverse, with why they were taken. The target they add up to is in [Architecture](../architecture.md#target-architecture).

- [Skin families only draw](./0001-skin-families-only-draw.md)
- [A runtime-neutral player-scene-model package](./0002-scene-model-package.md)
- [One play loop with judge strategies](./0003-one-play-loop.md)
- [Course, record and lamp rules live in @be-music/player-engine](./0004-domain-rules-in-player.md)
- [Designed public entry points; breaking changes allowed before 1.0](./0005-public-entry-points.md)
- [The host routes every scene transition through one scene router](./0006-scene-router.md)
- [System sounds share one AudioContext; each play keeps its own](./0007-one-system-audio-context.md)

- [0008: Independent Accounts and OIDC](./0008-accounts-oidc.md)

- [0009: Accounts owns public profiles and avatars](./0009-accounts-profiles.md)

- [Share a bounded worker pool for browser CPU tasks](./0010-browser-task-pool.md)

- [Hosts provide audio implementations](./0011-host-provided-audio.md)

- [Native screens share the scene sessions](./0012-native-skin-screens.md)

- [Reusable player interfaces are Web Components](./0013-player-ui-components.md)

- [Native draws its playfield with canvas components](./0014-native-playfield-components.md)

- [Seek is a play-loop command](./0016-seek-play-loop-command.md)

- [Mixed NONSTOP courses retain source units in the bmson IR](./0017-bmson-nonstop.md)

- [0018: Replay option timeline](./0018-replay-option-timeline.md)

- [0019: Option values name their source](./0019-source-qualified-option-values.md)

- [0020: Player UI elements are headless; themes and skins supply the look](./0020-headless-player-ui.md)

- [0021: A skin's stage may be fluid](./0021-fluid-stage.md)

- [0022: Conditional bmson BGA events follow deterministic chart time](./0022-bmson-bga-events.md)

- [0023: Generic bmson keyboards retain their declared layout](./0023-generic-bmson-keyboards.md)

- [0024: Extended BMS audio effects are prepared before host tempo changes](./0024-extended-bms-audio.md)

- [0025: Chart text follows engine time and judgment effects](./0025-chart-text-playback.md)

- [0026: Record effective chart display operations separately from user settings](./0026-chart-authored-display-options.md)
