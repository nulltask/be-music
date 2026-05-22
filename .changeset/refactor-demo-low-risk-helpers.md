---
'@be-music/player-web-demo': patch
---

Extract three self-contained slices of `PlayerWebDemoApp` into standalone modules: `chart-shape.ts` (pure derivations for chart shape + beatoraja-skin selection), `loading-overlay.ts` (DOM-only controller), `recording-controller.ts` (gameplay recorder / screenshot logic). No behaviour change; the demo class trims by ~260 lines.
