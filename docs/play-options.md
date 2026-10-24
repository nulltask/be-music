[日本語](./play-options.ja.md)

# Play options

The Debug Menu's **Play options** folder and the select screen share the same effective settings. Options that affect a new play are locked while it runs; saved preferences are restored on the next visit. Implementation follows the individual specifications and comments linked from [#755](https://github.com/nulltask/be-music/issues/755).

## START BPM HS-FIX

Choose **HS-FIX → STARTBPM** in Debug Menu. The default remains **OFF**. START anchors the chosen hi-speed to the chart header's starting BPM, separately from MAX, MIN and MAIN. When `#BASEBPM` supplies the reference speed, the multiplier is `reference BPM / starting BPM`; a tempo event at beat zero does not replace the header's starting BPM. Subsequent BPM changes still change the scroll rate. This is an ordinary visual speed option and preserves existing score, assist and course eligibility.

The mode and effective drawn hi-speed are recorded in the replay view. beatoraja skins receive START's original option index, 1. LR2 skins retain their original five HS-FIX button cells and cycle; choose START in Debug Menu. Skins can also select it through the shared play-options API.

Source: beatoraja 0.8.9 [`LaneRenderer.init`](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/LaneRenderer.java) and [`PlayConfig`](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/PlayConfig.java). Tracked in [#736](https://github.com/nulltask/be-music/issues/736).
