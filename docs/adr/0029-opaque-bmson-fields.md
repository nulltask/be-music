[日本語](./0029-opaque-bmson-fields.ja.md)

# 0029: Keep nonexecuted bmson fields on their normalized nodes

## Context

The bmson specification does not mandate unknown-key round trips. Upstream readers inconsistently ignore or reject such keys by object type. Retention is therefore a Be-Music editing/interchange policy. The [primary-source research](../research/bmson-unknown-fields.md) separates official fields, implemented extensions and unused shared decoder fields. The original 28-file corpus has no arbitrary unknown keys, but four GRAYSCALE charts each contain one nonexecuted hidden-note `damage: 0` that Be-Music previously discarded.

Saving one raw document cannot safely associate annotations after moving, removing or reordering notes. Reusing a filename as identity also mixes separate sound channels that share an asset. Letting opaque data override supported fields would bypass normalization or accidentally enable execution.

## Decision

Add optional `extraFields: JSONFields` envelopes to normalized bmson nodes. Capture root, info, BGA container/header/event/sequence/frame, sound/key/mine notes and preserved channel/timing entries. Event annotations stay on their `BeMusicEvent.bmson`; channel annotations are keyed by their assigned WAV slot in `bmson.channelExtraFields`, with `channelKinds` retaining the container kind even when it has no notes. `lineExtraFields` associates barline annotations with normalized pulses; native output maps those labels when scaling barline resolution. None of these fields affects lane inference, notes, timing, audio, judging, fingerprints or eligibility.

`JSONValue`/`JSONFields` describe JSON data only. Public `cloneJSONFields` makes owned deep copies and rejects empty/nonobject envelopes, nonfinite numbers, functions, nonplain objects and cycles. Invalid envelopes are omitted as a group. Repeated object references get independent copies. Literal `__proto__`, `constructor` and similar JSON keys remain ordinary own data properties. Parser IR normalization reads the envelope rather than treating its name as another external annotation; a native source field literally named `extraFields` remains representable inside the envelope.

`collectBmsonExtraFields` reserves every supported key at each external node scope. Native writing filters these keys out of annotations, including when the normalized field is absent because its source value was invalid. Supported normalized fields stay authoritative. Unused hidden-note damage/length/continuation and unused mine length/continuation are retained as opaque values, never promoted into executable event fields.

Be-Music JSON and `cloneJSON` retain all envelopes independently. Native bmson output merges opaque keys with normalized values on both validated preservation and canonical paths. Annotation edits participate in preservation equivalence, so changing an event or channel annotation regenerates it instead of restoring stale data. Same-filename channels remain independent. Moving/reordering nodes moves their annotations; deleting a normalized node removes them. Annotated empty channels and unknown-only BGA containers remain writable.

## Boundaries

This preserves data on valid normalized nodes, not source bytes: whitespace, number spelling/precision, invalid records and normalized-out duplicate identities are not guaranteed. Unchanged preserved arrays can retain their original order; canonical rewriting follows normalized IR and can renumber resources or reorder simultaneous sample triggers. Opaque payloads are not interpreted or rewritten as vendor resource references. Native BMS output has no annotation encoding; new chart composition is not a lossless merge of every source document's root/container metadata. The existing explicit skip-preservation-validation option continues to trust preserved arrays.

No new playback behavior is inferred from an unknown key. Supporting that key's semantics later requires a deliberate parser/model change and the corresponding replay/fingerprint policy. No third-party source charts or assets are committed.
