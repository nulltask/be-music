---
'@be-music/app-play': patch
---

Deciding a course with stages missing from the collection now opens a dialog listing those stages. For a course imported from a difficulty table, it looks each stage up in the table's song list (`data_url`, fetched through the proxy when first needed) and links to the song's, chart's and pack's download pages, which open in a new tab.
