---
'@be-music/service-web-theme': patch
---

Round avatars and the Accounts link on the Dashboard host.

- Avatars are always round: `avatarTemplate` drops its `shape` option and renders one shared style, a square cropped with `object-cover` so a non-square image is never stretched.
- The service footer's Accounts link opens the account page on the Dashboard host (`https://be-music.app/account`), where Accounts now runs.
