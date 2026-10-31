---
'@be-music/app-leaderboard': minor
---

Update pages in place instead of loading a new page: the filter switches, the chart page's file choice and the ruleset menu now fetch the page with htmx 4 and morph only the page body and the header, so the scroll position and focus stay, the switch slides over and the body dims only while a slow answer loads. Filter URLs still go into the history, and Back restores them in place. Signing out, hiding or showing a play and saving the profile or icon update the page the same way instead of reloading it. Without the client script the links work as before.
