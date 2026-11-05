---
'@be-music/service-web-theme': patch
---

Avatars are always round: `avatarTemplate` drops its `shape` option and renders one shared style, a square cropped with `object-cover` so a non-square image is never stretched.
