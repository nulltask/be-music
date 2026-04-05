[Japanese version](./README.ja.md)

# Specifications

This directory is a Markdown collection of specifications used in the `be-music` repository.

- [BMS implementation specification](./bms-spec.md)
- [BMSON implementation specification](./bmson-spec.md)
- [Bemuse implementation specification](./bemuse-spec.md)
- [Player implementation specification](./player-spec.md)
- [BMS/BMSON intermediate representation (`@be-music/json`) implementation specification](./json-spec.md)
- [Glossary](./glossary.md)

Supplement:

- These documents prioritize how this repository implements and interprets the formats over the original specifications themselves.
- If there is a discrepancy with the official specifications, please first decide on an implementation policy and then update this document.
- When performing large-scale follow-up updates, please specify the "audit starting point commit/audit point commit/audit scope" in each specification.
- `@be-music/json` is responsible for pure IR, and `@be-music/chart` is responsible for score semantics such as beat resolution and event order.
