---
'@be-music/app-play': patch
---

Fix saved folders that Chrome no longer answers for: removing or changing any saved folder failed with "Could not open or remember the folder." (`DataError: Failed to write blobs`), and pressing Reconnect waited forever and left Open folder unresponsive. Such a folder now shows "Pick <name> again", which opens the folder picker and replaces the saved folder with the one picked. The saved folders are stored without the folders that did not answer, so the other saved folders can still be removed or changed. A permission request that does not answer within 15 seconds no longer holds the folder buttons.
