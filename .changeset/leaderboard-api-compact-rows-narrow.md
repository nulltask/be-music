---
'@be-music/leaderboard-api': patch
---

Make the compact lists readable on a phone. Each list is now a size container: where it is narrower than 36rem, a row's details line runs on under the score and the info icon instead of wrapping down a narrow column between them, the title's badges wrap under the title instead of squeezing it to nothing, and the row drops what the info popover already lists (the rules played under, the gauge, the lane option, the lamp it came from, the play count) along with the avatar and the badge help tip. Wider lists keep the one-line layout.
