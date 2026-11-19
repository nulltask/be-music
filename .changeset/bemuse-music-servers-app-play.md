---
'@be-music/app-play': minor
---

Register Bemuse music servers in the Library & records section of Options, starting with the public servers (Bemuse's official server, flicknote, METTATUNES, The Forgetalia and yuinore.net). Each registered server's songs are listed as a library folder every time the player opens, and the list follows the Options settings to the player's other browsers.

Songs play as Bemuse serves them: packed sounds are read out of their `.bemuse` packages when a song is played, unpacked songs and the images and videos beside a package are read from the song folder, and the song's preview, background video (at `video_offset`), loading and back images and ReplayGain apply to its charts.

Chart files are kept between visits and checked against the server index, and a server that does not allow other sites to read it is read through the player's proxy.
