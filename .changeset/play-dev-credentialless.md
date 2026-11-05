---
'@be-music/app-play': patch
---

The dev server isolates the page with `Cross-Origin-Embedder-Policy: credentialless` instead of `require-corp`, matching the deployed player, so Google Fonts and provider avatars load in development too.
