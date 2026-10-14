---
'@be-music/leaderboard-api': minor
---

Show the Leaderboard in Japanese as well as English. A page's language comes from `?lang=` (so a shared link can carry one), then the viewer's pick (the new language menu in the header, kept in a cookie through `/leaderboard/lang/:locale`), then the browser's `Accept-Language`, then English. Every page is translated: the header, menus, sign-in and sign-up dialogs, footer and breadcrumbs, the Latest, chart, chartset, player, play, settings and not-found pages, the About and Help text, the play lists, info panel, help tips and cards, and the messages the pages' script shows (sign-in errors, profile errors, the share card). Game terms (lamp names, judgments, DJ LEVEL, ruleset names) stay as players use them.

Help tips and info cards now stay open while the pointer or focus moves into them, so their links can be used.
