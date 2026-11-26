---
'@be-music/app-desktop': minor
---

Sign in through the default browser, because Google refuses embedded browsers. When the window reaches the Accounts login page, the app opens the sign-in in the default browser, receives a single-use code through the `be-music-play://` URL scheme, redeems it with a verifier only the app knows for an Accounts session of its own, and finishes the player's sign-in in the window. The provider chosen with the player's Google or Discord button starts in the browser, and signing out of the player also ends the app's Accounts session, so the next sign-in can pick another account.
