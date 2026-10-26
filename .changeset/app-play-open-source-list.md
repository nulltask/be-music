---
'@be-music/app-play': patch
---

Fix the Help's Open source list: it now lists the third-party packages the build actually includes, read from the bundled modules (with the stylesheet's frameworks and the served ffmpeg core), instead of walking dependencies. Packages it missed (Lit, fengari, alien-signals, Tailwind CSS, Basecoat) are listed, type-only and tree-shaken packages are not, and packages that publish no LICENSE file (@ffmpeg/core, @ffmpeg/ffmpeg, @ffmpeg/util, @pixi/colord, signalsmith-stretch, tweakpane) show their upstream text; @ffmpeg/core's says where its GPL source is. The list loads when the tab opens.
