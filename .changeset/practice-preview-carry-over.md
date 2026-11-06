---
'@be-music/player-browser': patch
---

A PRACTICE bar's audition (`AudioService.preview.playWindow`) now also sounds what started before the bar and still rings at its bar line, such as a long BGM sample or a long note's keysound, from where it is there, as the loop play already does when it seeks to its start. Under BMS's monophonic WAV playback only each slot's last sample before the bar carries over.
