---
'@be-music/player': patch
---

Read an LR2 NONSTOP course as its first five stages, as LR2 plays it (its loader stitches at most five, OpenLR2 L25857-L25858); `LR2_MAX_NONSTOP_STAGES` names the limit. Before, a longer NONSTOP course was stitched with up to ten stages.
