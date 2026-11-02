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

- [0030: Make bmson zero-total recovery an explicit play policy](./0030-bmson-zero-total.md)

- [0031: Classify assists by option source, decide consequences by judge ruleset, and append lamps](./0031-assist-record-policy.md)

- [0032: Execute chart-authored HIDDEN, CHANGE-HS and CRAZY size / wave with Be-Music formulas](./0032-chart-authored-visual-families.md)

- [0033: Chart-authored RANDOM and judgment CRAZY options replace the player's, and are not assists](./0033-chart-authored-gameplay-options.md)

- [0034: Map chart-authored GAMELEVEL and EXTRA onto each ruleset's own gauges](./0034-chart-authored-gauge-options.md)

- [0035: Chart-authored NOTES options convert the chart in the engine, and the fingerprint carries the gameplay options](./0035-chart-authored-notes-options.md)
