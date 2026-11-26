---
'@be-music/app-dashboard': minor
---

Accounts can sign in the desktop app through the default browser. `/desktop/sign-in` issues a single-use code bound to the app's PKCE-style challenge and returns it through the `be-music-play://` URL scheme; `POST /api/auth/desktop-sign-in/redeem` exchanges the code and verifier for a new Accounts session in the app. A login page opened with `next` returns there after signing in, and `/desktop/sign-in` passes `sign_in_method` on so the login page starts the provider the app asked for.
