---
'@be-music/player-web-demo': patch
---

Split the 3,979-line demo entry point into feature modules: pull the inline HTML template (`dom-template.ts`), shared type declarations (`types.ts`), browser-compat panel (`compat-panel.ts`), READTEXT overlay (`readtext-overlay.ts`), and standalone utilities (`demo-utils.ts`) out of `main.ts`. `PlayerWebDemoApp` itself is unchanged; main.ts drops to ~3,200 lines.
