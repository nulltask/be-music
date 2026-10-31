---
'@be-music/chart-model': minor
---

Resolve EXWAV-only sample filenames consistently and use MacBeat percentage volume (100 is unity). Add resolveBmsWAVResources and wavCmdVolumePercentToLinearGain. Parse WAVCMD 02 as duration rather than loop, reject malformed EXWAV parameters and constrain playback attenuation to its dialect bounds.
