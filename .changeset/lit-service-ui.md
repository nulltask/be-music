---
'@be-music/service-web-theme': minor
---

Add shared Lit components and templates through the `/client` entry and move HTML rendering to `/server` so services can share UI while keeping server dependencies out of browser bundles.

Share localized authentication panels and action buttons, header popovers and language pickers, and account identities and avatars across the services so their markup, accessibility, and display rules stay consistent while each application retains its requests and navigation.
