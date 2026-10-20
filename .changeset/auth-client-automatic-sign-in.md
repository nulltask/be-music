---
'@be-music/service-auth-client': patch
---

Automatically establish an app session from an existing Accounts session when a browser opens a service page. Use prompt=none with PKCE and state validation, keep public pages accessible when Accounts is signed out, and suppress automatic retries after explicit sign-out.

Rename the package from `@be-music/auth-client` to `@be-music/service-auth-client` to identify its role consistently. Update imports and package filters to the new name.
