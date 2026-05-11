---
'@be-music/player-web-demo': patch
---

Help modal now documents beatoraja skin support alongside Lunatic Rave 2.
The verified-skin note lists the four checked combinations: LR2 default,
beatoraja default (`skin/default`), `ModernChic`, and `GdbG Original Skin`.
"LR2 skin's PLAY / PLAY OPTION" wording is generalized to "the active skin's"
since both rendering paths surface those buttons. Mirrored across the
English and Japanese help panes. The change shipped as part of the
beatoraja-skin work but was missed by the v0.2.3 release window.
