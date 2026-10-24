[日本語](./play-options.ja.md)

# Play options

The Debug Menu's **Play options** folder and the select screen share the same effective settings. Options that affect a new play are locked while it runs; saved preferences are restored on the next visit. Replays keep the selected option snapshot and timed changes, alongside effective chart, view and tempo state; score policy is handled separately by the Leaderboard. Implementation follows the individual specifications and comments linked from [#755](https://github.com/nulltask/be-music/issues/755).

## START BPM HS-FIX

Choose **HS-FIX → STARTBPM** in Debug Menu. The default remains **OFF**. START anchors the chosen hi-speed to the chart header's starting BPM, separately from MAX, MIN and MAIN. When `#BASEBPM` supplies the reference speed, the multiplier is `reference BPM / starting BPM`; a tempo event at beat zero does not replace the header's starting BPM. Subsequent BPM changes still change the scroll rate. This is an ordinary visual speed option and preserves existing score, assist and course eligibility.

The mode and effective drawn hi-speed are recorded in the replay view. beatoraja skins receive START's original option index, 1. LR2 skins retain their original five HS-FIX button cells and cycle; choose START in Debug Menu. Skins can also select it through the shared play-options API.

Source: beatoraja 0.8.9 [`LaneRenderer.init`](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/LaneRenderer.java) and [`PlayConfig`](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/PlayConfig.java). Tracked in [#736](https://github.com/nulltask/be-music/issues/736).

## Persistent display-area information

Choose **Display area info** in Debug Menu: **OFF** (default), **ON**, **SUDDEN+ ONLY**, or **HID+/LIFT ONLY**. These are the four choices shown by That-Which-Must-Not-Be-Named AC 34. On an active cover, the selected edges keep showing its length on the 0–1000 scale and the green number without holding START. Each DP side uses its own cover and visible time. A disabled cover has no added label. The original skin's own readouts remain available with OFF.

The same folder exposes the existing LR2 **Effect 1P / 2P**, **Lane cover** and **Cover height** settings. Changing the family keeps these settings. Native uses DOM labels; Canvas, LR2 and beatoraja use Canvas labels, which are included in captures. Readout visibility is a saved viewing preference; it changes no input, judgment, scroll or replay eligibility. The source page does not specify additional recording restrictions for this setting.

Source: AC 34 [BPM-change options](https://p.eagate.573.jp/game/2dx/34/howto/new/bpm_option.html), including the four-choice settings screenshot. Tracked in [#748](https://github.com/nulltask/be-music/issues/748).

## Per-side AUTO SCRATCH

Debug Menu's **Auto scratch 1P / 2P** switches independently automate each side's scratch notes. The other side remains manual, including long scratch notes. This follows the per-side AUTO SCRATCH setting tracked in [#708](https://github.com/nulltask/be-music/issues/708). Replays retain the effective side switches as well as the selected option snapshot; old replays with only the combined switch apply it to both sides. Score policy remains the Leaderboard's responsibility.
