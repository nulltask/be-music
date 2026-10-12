---
'@be-music/player-web-demo': minor
---

Add a "Play in silent mode" setting to the Debug Menu's Volume folder for browsers with the Audio Session API (Safari on iPhone / iPad), so the demo can be heard with the silent switch on. It is off by default because it pauses music playing in other apps; the choice is remembered and applied before audio starts and again on the first tap. The first time sound starts on a phone or tablet with the setting off, a small dismissible hint offers to turn it on. The label, note, and hint follow the browser language (English / Japanese).
