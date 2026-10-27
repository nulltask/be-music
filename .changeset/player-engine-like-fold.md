---
'@be-music/player-engine': patch
---

Course chart filters with `LIKE` evaluate faster: the ASCII case fold returns text without capitals as it is and folds ASCII-only text with `toLowerCase`, keeping the letter-by-letter fold only for text with non-ASCII characters. Matching is unchanged; the fold was about a third of `evaluateCourseChartFilter`.
