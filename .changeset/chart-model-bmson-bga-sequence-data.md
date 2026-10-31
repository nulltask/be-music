---
'@be-music/chart-model': minor
---

Expose deterministic bmson BGA event-layer resolution: sequences with authored millisecond frame times, header-index references, missing images and end markers, conditional image sets and frame lookup. Event-layer consumers can keep ordinary layer changes as selection clears, conditional and sequence events stay out of the normal image timeline, and resolved event cues retain NONSTOP stage ownership, trim anchors, FIT playback rates and exclusive animation windows. A selected conditional MISS definition clears an earlier POOR image so it cannot reappear after a short sequence ends. An `id_set`-only `bga_events` or `poor_events` entry reads beatoraja's default id 0: it shows header id 0 when one exists and otherwise changes nothing.
