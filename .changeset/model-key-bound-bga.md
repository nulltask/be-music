---
'@be-music/chart-model': minor
---

Add standard SWBGA parsing, A5 selection timelines and millisecond frame selection, preserving packed BMP00 frames and raw ARGB fields separately from the legacy cue-driven animation API. Exclude A0–A6 controls from WAV sample triggers so matching resource ids cannot play unrelated audio.
