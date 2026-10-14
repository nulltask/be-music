---
'@be-music/leaderboard-api': minor
---

Show the Leaderboard in Japanese as well as English. A page's language comes from `?lang=` (so a shared link can carry one), then the viewer's pick (the new language menu in the header, kept in a cookie through `/leaderboard/lang/:locale`), then the browser's `Accept-Language`, then English. This first step translates the header, menus, sign-in and sign-up dialogs, footer and breadcrumbs, the Latest and chart pages, the play lists, info panel, help tips and cards; the other pages follow. Game terms (lamp names, judgments, DJ LEVEL, ruleset names) stay as players use them.

Help tips and info cards now stay open while the pointer or focus moves into them, so their links can be used.
