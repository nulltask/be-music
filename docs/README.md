[Japanese version](./README.ja.md)

# Specifications

This directory is a Markdown collection of specifications used in the `be-music` repository.

- [BMS implementation specification](./bms-spec.md)
- [BMSON implementation specification](./bmson-spec.md)
- [Bemuse implementation specification](./bemuse-spec.md)
- [Player implementation specification](./player-spec.md)
- [Browser player implementation notes](./player-web.md)
- [LR2 skin implementation notes](./lr2-skin.md)
- [beatoraja skin implementation notes](./beatoraja-skin.md)
- [BMS/BMSON intermediate representation (`@be-music/json`) implementation specification](./json-spec.md)
- [Glossary](./glossary.md)

Supplement:

- These documents prioritize how this repository implements and interprets the formats over the original specifications themselves.
- If there is a discrepancy with the official specifications, please first decide on an implementation policy and then update this document.
- Keep these documents focused on the current implementation. Put past decisions in pull requests, commit messages, and changelogs.
- `@be-music/json` is responsible for pure IR, and `@be-music/chart` is responsible for score semantics such as beat resolution and event order.
- `@be-music/player` is the shared engine package. Terminal-specific behavior lives in `@be-music/player-tui`, and browser-specific behavior lives in `@be-music/player-web`.
- `@be-music/lr2-skin` and `@be-music/beatoraja-skin` keep skin parsing renderer-independent. Browser PixiJS rendering is documented under `@be-music/player-web`.
