---
'@be-music/player-browser': patch
---

The play screens draw chart-authored display options from the engine frame's effective chart options:

- Notes fade, move and resize under HIDDEN, CHANGE-HS and the CRAZY sizes and waves (X / Y / XY / 3D), take STAR colours, SPIN rotation and CLONE afterimages.
- REVERSE mirrors the note stream and HIDJUDGE hides the judgment display. DARK hides the BGA, and DARK2 the bombs as well.
- LINEMOVE raises the judgement line through LIFT on views that draw it, and M-SUDDEN shows the player's SUDDEN+ cover, which F3 and F4 move.
- LR2 and beatoraja skins keep their own judgement line under REVERSE, and LR2 skins, which have no LIFT, ignore LINEMOVE.
