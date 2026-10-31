---
'@be-music/chart-writer': minor
---

Carry ordinary BGA across format conversions instead of dropping it. `stringifyBmson` writes a BMS chart's `#BMPxx` images and `04` / `07` / `06` cues as bmson header and base / layer / POOR events (with `#BMP00` as the initial POOR image), and `stringifyBMS` writes a bmson chart's header and events as `#BMPxx` resources and `04` / `07` / `06` objects. A new `onDiagnostic` option on both reports what the target format cannot represent (layer2 cues, BMS BGA extensions, bmson sequences and conditional layers, layer black transparency, `#POORBGA 1`) instead of losing it silently.
