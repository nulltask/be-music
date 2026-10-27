---
'@be-music/player-browser': minor
---

The player's MY COURSES and MY NONSTOP folders end with LR2's RANDOM MIX bar (`createRandomMixEntry`, listed by `resolveCourseMakerFolders`). `CourseMaker` keeps the RANDOM MIX settings (`randomMixSettings`, `stepRandomMixSetting`) and `drawRandomMix` keeps each folder's last draw as its newest course in place of the previous one; `createRandomMixChart` and `createDrawnRandomMixEntry` turn library charts into draw candidates and a draw into a course bar. On an LR2 select skin, buttons 260-266 step the settings with the option-change cue and texts 190-196 show them.
