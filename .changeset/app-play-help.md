---
'@be-music/app-play': patch
---

Rework the Help:

- Usage covers Native, the 2P seventh key, PMS keys, the lane cover keys, seeking, courses and saved settings. It had still listed two built-in skins and six 2P keys.
- A new Options tab describes every Debug Menu control folder by folder, the play options included, and when each control appears.
- Open source lists the third-party packages the build actually includes, read from the bundled modules (with the stylesheet's frameworks and the served ffmpeg core), instead of walking dependencies: packages it missed (Lit, fengari, alien-signals, Tailwind CSS, Basecoat) are listed, type-only and tree-shaken packages are not, and packages that publish no LICENSE file show their upstream text (@ffmpeg/core's says where its GPL source is). Each license text starts folded, and the list loads when the tab opens.
