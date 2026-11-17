---
'@be-music/app-play': patch
---

Add a Difficulty tables list to Options → Course in place of the Table URL field: it shows every remembered table by name, adds one by URL, removes one (taking its courses off the select screen at once), and adds back the well-known tables removed from it. The removed well-known tables are stored and synced with the settings, so removing the last table leaves the list empty instead of returning to the defaults.
