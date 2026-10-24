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

## LEGACY NOTE and LN REMOVE

Debug Menu's **Long notes** selector defaults to **OFF**. **LEGACY NOTE (AC 34)** replaces charge notes and backspin scratches with their head note; ordinary LN remains unchanged. HCN is outside this AC option's scope and remains unchanged. **LN REMOVE (beatoraja)** replaces every LN, CN and HCN with its head note, including scratch lanes, as beatoraja 0.8.9's REMOVE modifier does at its full removal rate. Both retain the head keysound and time and remove tail judgment and tail audio. A chart without matching notes is unchanged.

The engine and renderer share the transformed notes. Replays store the source modifier and effective head-only note chart, while the original chart fingerprint continues to identify the loaded chart. Reopening a replay applies the recorded modifier before restoring its lane arrangement. The selector is locked during play because these source modifiers prepare the chart before play; this introduces no new score or lamp policy.

Sources: AC 34 [assist options](https://p.eagate.573.jp/game/2dx/34/howto/play/option.html), beatoraja 0.8.9 [`LongNoteModifier`](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/pattern/LongNoteModifier.java). Tracked in [#710](https://github.com/nulltask/be-music/issues/710).

## A-SCR & LEGACY NOTE

Debug Menu's **A-SCR & LEGACY NOTE (AC 34)** button applies the AC 34 combined preset in one operation: AUTO SCRATCH on both play sides and LEGACY NOTE. The existing switches and Long notes selector immediately show the effective settings; use them to select an individual operation or turn it off. Only CN/BSS tails are removed, and only scratch notes are automated. Both operations are recorded explicitly, including their effective note chart, so replay does not infer an assist from a visual preset name. The button is disabled during play. Score and lamp handling remains deferred to the Leaderboard.

Source: AC 34 [assist options](https://p.eagate.573.jp/game/2dx/34/howto/play/option.html). Tracked in [#711](https://github.com/nulltask/be-music/issues/711).

## EX-HARD

Choose **Judgment windows → beatoraja / ????** in Debug Menu's Developer folder, then **Play options → Gauge → EX-HARD**. EX-HARD is an independent survival gauge, not AUTO SCRATCH or another input assist. The gauge starts at 100 and fails at zero, without HARD's low-life damage reduction. The existing source tables retain beatoraja's mode-specific damage and recovery and AC's separate values. beatoraja's **HAZARD** remains a different choice (the replay's existing `DEATH` key); old AC replays with that key retain their former interpretation.

LR2 beta3 has no EX-HARD choice: its menu keeps GROOVE / HARD / DEATH / EASY, and requesting EX-HARD directly with LR2 rules fails explicitly. Changing to a ruleset that does not support the selected gauge restores its normal gauge. LR2 skin buttons keep their original four cells and cycle; when that skin displays a play using EX-HARD from another ruleset, its survival gauge uses the red presentation. Choose EX-HARD in Debug Menu. Replays store `play.gauge: "EX-HARD"` and the source gauge result name; course conversion uses EXHARDCLASS for beatoraja / AC.

Sources: beatoraja 0.8.9 [`GaugeProperty`](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/GaugeProperty.java), AC 34 [gauge options](https://p.eagate.573.jp/game/2dx/34/howto/play/option.html). Tracked in [#726](https://github.com/nulltask/be-music/issues/726).

## ASSIST EASY / ASSISTED EASY

With beatoraja rules, Debug Menu offers **Gauge → ASSIST EASY**; with ???? rules, it offers **ASSISTED EASY**. Both select a gentler recovery gauge, independently of AUTO SCRATCH and long-note modifiers. The replay's selected gauge is `ASSIST-EASY`; the effective result retains the source name `ASSIST-EASY` or `ASSISTED-EASY`. No input-assist switch is inferred from the gauge name.

The existing beatoraja tables retain their mode-specific recovery, damage and clear border: 60 for seven-key play and 50 for five-key play. AC uses its own recovery/damage and a clear border of 60. LR2 beta3 has neither option and rejects a direct request. A beatoraja / AC course converts this recovery choice to CLASS, as the source course gauge conversion does. LR2 skins keep the original EASY sprite cell and normal gauge presentation while their text readout keeps the selected name. Score policy remains separate.

Sources: beatoraja 0.8.9 [`GaugeProperty`](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/GaugeProperty.java), AC 34 [ASSISTED EASY](https://p.eagate.573.jp/game/2dx/34/howto/play/option.html). Tracked in [#725](https://github.com/nulltask/be-music/issues/725).
