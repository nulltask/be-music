---
'@be-music/player': minor
---

Load a difficulty table's courses from its URL: `resolveTableHeaderUrl` finds the `<meta name="bmstable">` header link in a table page, and `fetchTableHeaderCourses` follows a page URL (or reads a header JSON URL directly) through an injected `fetchText` and returns the table's label and courses, without fetching the `data_url` song list. Both are exported from `@be-music/player/course`.
