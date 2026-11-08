[Japanese version](./README.ja.md)

# @be-music/chart-source

The pure intermediate representation (IR) of BMS and bmson charts used inside Be-Music. It is JSON compatible and preserves the source data so a chart can round-trip back to BMS or bmson.

`@be-music/chart-source` is Be-Music's internal data model. It is not designed as a distribution format or a reusable exchange format with other tools. The semantics helpers of a chart (beat resolution, event order, long note resolution) live in [`@be-music/chart-model`](../chart-model/README.md); `@be-music/chart-source` itself is responsible for the pure IR and round-trip preservation.

The package is runtime-neutral: it imports no Node built-in and uses no DOM or Node-only globals.

See the [BMS/bmson intermediate representation specification](../../docs/json-spec.md).
