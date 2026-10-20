---
'@be-music/auth-client': patch
---

Automatically establish an app session from an existing Accounts session when a browser opens a service page. Use prompt=none with PKCE and state validation, keep public pages accessible when Accounts is signed out, and suppress automatic retries after explicit sign-out.
