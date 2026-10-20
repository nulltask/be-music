[Japanese version](./README.ja.md)

# Specifications

This directory is a Markdown collection of specifications used in the `be-music` repository.

- [Architecture: the chart layers, the engine and the package layers](./architecture.md)
- [Architecture decisions](./adr/README.md)
- [BMS implementation specification](./bms-spec.md)
- [BMSON implementation specification](./bmson-spec.md)
- [BMS / bmson compatibility notes (de jure vs de facto)](./format-compat.md)
- [LR2 and beatoraja semantics](./semantics-lr2-beatoraja.md)
- [Bemuse implementation specification](./bemuse-spec.md)
- [Player implementation specification](./player-spec.md)
- [Terminal player implementation notes](./player-tui.md)
- [Browser player implementation notes](./player-web.md)
- [Scene models (`@be-music/scene-model`)](./scene-model.md)
- [Play log (play history) specification](./playlog.md)
- [Courses and dan certification](./course.md)
- [Course browser checklist](./course-checklist.md)
- [Be-Music Fingerprint specification](./fingerprint-spec.md)
- [Leaderboard design](./leaderboard.md)
- [Services and environments](./services.md)
- [LR2 skin implementation notes](./lr2-skin.md)
- [beatoraja skin implementation notes](./beatoraja-skin.md)
- [Writing a be-music skin](./be-music-skin.md)
- [BMS/BMSON intermediate representation (`@be-music/json`) implementation specification](./json-spec.md)
- [Glossary](./glossary.md)

Supplement:

- These documents prioritize how this repository implements and interprets the formats over the original specifications themselves.
- If there is a discrepancy with the official specifications, please first decide on an implementation policy and then update this document.
- Keep these documents focused on the current implementation. Put past decisions in pull requests, commit messages, and changelogs.
- `@be-music/json` is responsible for pure IR (the Source layer), and `@be-music/chart` is responsible for score semantics such as beat resolution and event order, including `resolveChart`, the single step to the Resolved layer every player-side package reads (see [Architecture](./architecture.md)).
- `@be-music/player` is the shared rules and engine package. Terminal-specific behavior lives in `@be-music/player-tui` and [Terminal player implementation notes](./player-tui.md), while browser-specific behavior lives in `@be-music/player-web` and [Browser player implementation notes](./player-web.md).
- `@be-music/scene-model` holds what every screen shows and how it behaves, independent of the skin family ([Scene models](./scene-model.md)); in `@be-music/player-web`, scene sessions run it and family views draw it.
- `@be-music/lr2-skin` and `@be-music/beatoraja-skin` keep skin parsing renderer-independent. Browser PixiJS rendering is documented under `@be-music/player-web`.
