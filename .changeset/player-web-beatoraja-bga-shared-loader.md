---
'@be-music/player-web': patch
---

Load a beatoraja play's BGA the way the LR2 and default gameplay scenes do: TGA and other non-browser image formats now show, bmson charts get their `bga.header` images, `#BGAxx` sub-region slots crop their source `#BMPxx`, and a BMS layer image has its black keyed out. Before, the beatoraja prep decoded only what `createImageBitmap` could read from `#BMPxx`, so these BGAs stayed blank. Both families now share one BGA loader.
