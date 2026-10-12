---
'@be-music/player': minor
---

Play logs now record which software wrote them in a top-level `recorder` field (`PlaylogRecorderInfo`: `name`, `version`, `build`, `engine`, `platform`), so a log can be traced back to the build that recorded it when a recording bug turns up. Hosts declare the application fields through `recordPlaylog.recorder`; the recorder always stamps `engine` with the `@be-music/player` version, and `parsePlaylog` reads the field back.
