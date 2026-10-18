---
'@be-music/player-web-demo': minor
---

Add "Play in silent mode" for browsers with the Audio Session API (Safari on iPhone / iPad), so the demo can be heard with the silent switch on. It sits on the start card under "Drop to load", with a note that it pauses music playing in other apps, and in the Debug Menu's Audio folder; both are the same setting. It is on by default, remembered, and applied before audio starts and again on the first tap. The first time sound starts on a phone or tablet with the setting off, a dismissible hint offers to turn it on. The label, note and hint follow the browser language (English / Japanese).
