---
'@be-music/app-play': patch
---

Fix the MY COURSES, MY NONSTOP and MY DAN folders disappearing from the select screen when no course file or difficulty table was loaded: charts loaded from Bemuse music servers, a dropped ZIP archive or a `?music=` URL replaced the library without listing the player's own course folders again. Every chart load now lists them again.
