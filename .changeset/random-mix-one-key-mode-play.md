---
'@be-music/app-play': patch
---

Fix a NONSTOP RANDOM MIX of four or five stages that often failed to start with "cannot stitch the NONSTOP course: id-space": stages with many keysounds are now stitched together however many keys they use.

The RANDOM MIX dialog's Keys are now radio buttons: one key mode per mix, EXPERT and NONSTOP alike, as LR2 draws in one key mode. With several picked, the match count counted charts a run could not reach and a run whose stage 1 came from a key mode with few charts came out shorter than asked. Conditions saved with several key modes open on one of them (7 keys when they included it).
