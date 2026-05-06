---
'@be-music/beatoraja-skin': minor
---

Add strict-typed normalization for `image[]`, `destination[]`, and `source[]`.

- `normalizeBeatorajaImages()` produces a flat `BeatorajaImageElement[]` from the loose JSON tree, defaulting
  `divx`/`divy` to 1, validating numeric fields, and flattening `if`/`values` blocks. Helpers
  `imageFrameRect()` / `imageFrameAt()` / `imageRefFrame()` derive the displayed cell rect for a given frame
  index, animated time, or `ref`-driven op-code value.
- `normalizeBeatorajaDestinations()` produces `BeatorajaDestinationGroup[]` with always-populated keyframes —
  beatoraja's "carry-forward unspecified field" semantics is honored at normalization time so consumers can
  treat each keyframe as fully defined. `sampleBeatorajaDestination()` performs linear keyframe interpolation
  with `loop` wrap-around.
- `bundleBeatorajaSources()` resolves every `source[]` entry's path (wildcards + `filepath[]` overrides) and
  bundles loaded bytes into an `id → Uint8Array` map. Unresolved entries (missing files, deferred handles) are
  surfaced as warnings rather than thrown errors so the renderer can fall back gracefully.
- 27 new unit tests cover field defaults, frame math, keyframe carry-forward + interpolation + loop, wildcard
  expansion, and `filepath[]` override precedence.
