---
'@be-music/shared-utils': minor
---

Add `resolveSampleSliceEnvelope`, `sampleSliceEnvelopeGain` and `SAMPLE_SLICE_FADE_SECONDS`, which compute the short linear ramps that keep a bmson sound slice from clicking where it cuts its source file. A continuation slice crossfades with the one before it and sums back to the uncut waveform.
