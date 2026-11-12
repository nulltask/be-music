[日本語](./lr2-14key-scratch-avoidance.ja.md)

# LR2 14 KEY scratch-side avoidance

[#1076](https://github.com/nulltask/be-music/issues/1076) concerns the lane placement of S-RANDOM and CONVERGE when a scratch and a key occur at the same time in 14 KEY.

## LR2 beta3 reference behavior

- LR2 sorts the full object array by real time before placing notes. The comparator uses time alone. An earlier sort uses the object code to break ties in BMS time, but the later sort can reorder equal-time objects. The key can therefore be placed before the scratch even when the scratch precedes it in the input to the real-time sort. [OpenLR2 earlier sort](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26397) · [OpenLR2 real-time sort](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L27065) · [Comparators](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L23975-L24011)
- When the placement pass reaches a scratch object in 14 KEY, it marks keys 4–7 on 1P or keys 1–4 on 2P. The marks affect later draws on that side and row. A key already placed on the row stays in its destination. The scratch marking block runs only in 14 KEY. [OpenLR2 marking block](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L27404-L27424)
- S-RANDOM and CONVERGE both reject a destination occupied by a simultaneous object or held long note. For an otherwise eligible destination, a marked key is accepted only when every destination in the draw range is marked. The fallback checks marks separately from occupancy. A held near key can remain unmarked and keep a free far key ineligible. CONVERGE tries its fixed target first and uses the same acceptance checks. [OpenLR2 draw and retry](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L27367-L27405)

OpenLR2 clears each side’s marks as input time advances, using the original object code before DP FLIP. It marks the scratch using the resulting code after lane transforms. [OpenLR2 reset and DP FLIP](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L27274-L27321)

## Executable checks

The local LR2 beta3 100201 `LR2body.exe` has SHA-256 `a46ef15343e41d3411771c83ac7b0c42d95e5f473db69c6b45a9584c07e94480`. The checks executed the original 32-bit code in Unicorn with synthetic object records. They exercised the embedded sort at `0x717f80` with comparator `0x4ac2b0`, as called at `0x4b418d–0x4b4196`, and the placement and marking block at `0x4b4cd1–0x4b4e7f`. The placement harness supplied controlled returns for the random draw at `0x6c95e0`. It did not launch the Windows application or load a BMS file through its parser.

| Probe                                                                     | Observed result                                                                               |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Sort a same-time 1P scratch and key 1 in that input order                 | Key 1 before scratch                                                                          |
| Sort the same pair with four earlier and four later records               | Scratch before key 1                                                                          |
| Sort a same-time 2P scratch and key 1 in that input order                 | Key 1 before scratch                                                                          |
| 14 KEY, key processed first                                               | S-RANDOM accepts the far draw. CONVERGE accepts the far fixed target.                         |
| 14 KEY, scratch processed first                                           | S-RANDOM and CONVERGE reject the far destination and accept the next near draw on both sides. |
| 10 KEY flag, scratch processed first                                      | The scratch block sets no avoidance marks.                                                    |
| 14 KEY, 1P scratch first, all three near keys already marked              | The free far draw is accepted.                                                                |
| 14 KEY, 1P scratch first, keys 2 and 3 marked and key 1 held but unmarked | The tested far draws are still rejected. The harness stops at its draw limit.                 |

For the sort probes, the pair is at time 1000. The four earlier records are at 100, 110, 120 and 130, and the four later records are at 1100, 1200, 1300 and 1400. The placement probes offer key 5 then key 1 on 1P and key 2 then key 5 on 2P. CONVERGE is configured to try the corresponding far destination first. These checks cover the isolated routines without DP FLIP.

## AC and PC reference behavior

Konami describes arcade S-RANDOM as randomizing individual notes while leaving the scratch in place. The INFINITAS manual describes how H-RANDOM depends on S-RANDOM. These sources do not specify whether scratch rows change the choice of key destinations in double play. AC and PC placement on those rows remains unverified. [Arcade options manual](https://p.eagate.573.jp/game/2dx/26/howto/play/option.html) · [INFINITAS options manual](https://p.eagate.573.jp/game/infinitas/2/howto/option.html)

## Be-Music implementation decision

Be-Music builds the sort input from the resolved chart, measure records, BGM, BGA, BPM and STOP objects, then reproduces LR2 beta3’s real-time sort and placement retries. BMS regression fixtures cover both processing orders on both sides of 14 KEY, with a 10 KEY control. The executable comparison covers the isolated sort and placement routines. Full parity with LR2’s loader is unverified. For bmson, the input comes from Be-Music’s resolved objects.

The shared S-RANDOM option uses its existing placement under the AC judge ruleset. Chart preparation reports an error if no destination qualifies or 1,024 attempts fail. Existing replays supply their recorded arrangement.
