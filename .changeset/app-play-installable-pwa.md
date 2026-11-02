---
'@be-music/app-play': minor
---

Be-Music Play can now be installed as an app (Chrome and Edge on desktop and Android, Add to Home Screen on iOS) and starts offline once it has been opened online, so dropped charts play without a network. The player page links a web app manifest with maskable and Apple touch icons, and a service worker precaches the app shell from the build (about 5 MB, the embed page and the 31 MB ffmpeg core left out). Page loads go to the network first, so an online start always gets the latest deploy; a new worker takes over at the next start and drops the old caches. The ffmpeg core and the UI fonts are cached the first time they load. The Worker's routes (sign-in, accounts, player settings, the Leaderboard API, the URL proxy), `?music=` / `?skin=` archives, writes and other cross-origin requests are never cached.
