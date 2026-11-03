---
'@be-music/service-web-theme': minor
---

Share Lit service templates through explicit browser and server entries.

- Add `/client` exports for status components and shared authentication, account identity, avatar, header, footer, language, and popover templates. Register status elements explicitly with `defineServiceUI`.
- Add `/server` exports for synchronous HTML rendering and server versions of the shared templates. Import rendering functions such as `renderServiceHeader`, `renderServiceFooter`, and `renderBuildInfo` from `/server` rather than the package root; keep this entry out of browser bundles.
- Keep locale helpers, service models, and compiled styles available from the root entry.
