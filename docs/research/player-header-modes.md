[日本語](./player-header-modes.ja.md)

# PLAYER headers and two-player mode selection

Investigated 2026-10-31 for #837. No runtime changes are made by this research.

## Native sources and limits

The [original specification by Urao Yane](https://bm98.yaneu.com/bm98/bmsformat.html) defines 1=Single, 2=Two and 3=Double, and assigns channels 11–17 and 21–27 to the two play sides. It does not define value 4.

The [official BM98k site, archived 2001-12-25](https://web.archive.org/web/20011225152255/http://bm98.cup.com/main.htm), links its own [compiled manual](https://web.archive.org/web/20011007035736/http://bm98.cup.com/bm98_k.chm). In that manual `14.html` explicitly defines 1=SinglePlay, 2=CouplePlay, 3=DoublePlay and 4=BattlePlay. `08.html` documents user shortcuts for forcing BattlePlay or DoublePlay while loading, except when BP/DP was already specified by the chart. It does not state what PLAYER4 does with independently authored 2P objects. The CHM was read without running the executable.

The [command observations](https://hitkey.nekokan.dyndns.info/cmds.htm#PLAYER) distinguish COUPLE (each player plays one authored side, separate gauges) from BATTLE (two players play the same single chart, separate gauges). Their PLAYER4 duplication explanation is observational evidence, not a bank-overwrite rule established by the original format text. A PLAYER4 chart with existing distinct 2P notes remains ambiguous from the primary documents inspected.

Modern first-party manuals illustrate why the header cannot override layout indiscriminately: nanasigroove's `_RESOURCE/11_1_bms.html` declares PLAYER unsupported; charatbeatHDX's `FILES/html/06.html` declares it unsupported and infers SP/DP from object presence. These are inside the [official archived nanasigroove release](https://web.archive.org/web/20131228034524/http://d11x.sakura.ne.jp/software/nanasigroove/nanasi_1552_full.zip) and [official archived HDX release](https://web.archive.org/web/20211214030536/http://www.charatsoft.com/software/download/charatbeatHDX_v1.18.zip), respectively.

## Actual corpus: header counts are not broken-play counts

All 20 files flagged by the existing manifest were reread, and all SHA-256 hashes still match. They are 20 distinct byte streams: **PLAYER2=20, PLAYER4=0**. Counts are 1 Starter Pack, 3 GdbG2022, 0 GdbG2023, 16 GdbG2024, 0 GdbG2025. This is **20/2,720 BMS files=0.74%**, or **20/2,748 charts=0.73%**. No actual PLAYER4 behavior can be inferred from this corpus.

The current parser/model, supplied each chart's real extension, resolves **8 PMS-STD 9KEY, 4 SP 7KEY, 7 DP 14KEY, 1 DP 10KEY**. PMS uses 22–25 as part of a single nine-key layout, not as proof of a second player. The SP files have no nonzero 2P visible/LN objects. Seven of eight DP-layout files explicitly identify themselves as DP in subtitles and/or author readmes. Thus even layout-gated automatic PLAYER2 selection would change seven authored DP charts into two-player play.

The remaining 10KEY `roop_inasummerday_tp.bms` has an author readme crediting separate DP and 2P charts and a separate `_dp.bms` sibling. This is positive evidence of a genuine two-player artifact. It does not justify treating every modern PLAYER2 header the same way.

Umikaze Moment's bundled `_readme.txt` separately lists five SP, four DP and four 9key difficulties, and says it was tested with LR2/beatoraja. Four SP files below use PLAYER2 despite explicit SP subtitles and absent 2P data. SP NORMAL, credited to a different chart author, uses PLAYER1. These facts establish intended chart categories; they do not establish why the other author chose PLAYER2. Do not present an inferred editing/template mistake as a verified author statement.

The table counts raw nonzero visible and LN endpoint objects, not judged notes; LN pairing and duplicate-note resolution can change judged counts. Full paths are relative to `~/Downloads/bms`.

| File                                                                                        | PLAYER | Resolved keys | Visible 1P / 2P | LN objects 1P / 2P |
| ------------------------------------------------------------------------------------------- | -----: | ------------: | --------------: | -----------------: |
| `BMS_Starter_Pack/2007/roop_-_in_a_summer_day/roop_inasummerday_tp.bms`                     |      2 |            10 |       240 / 240 |              0 / 0 |
| `gdbg_bms_package_2022/GdbG BMS Package 2022/qfeileadh_MESMERA/_MESMERA_11_DPE.bms`         |      2 |            14 |       124 / 129 |              6 / 4 |
| `gdbg_bms_package_2022/GdbG BMS Package 2022/qfeileadh_MESMERA/_MESMERA_13_DPN.bms`         |      2 |            14 |       718 / 685 |            44 / 38 |
| `gdbg_bms_package_2022/GdbG BMS Package 2022/slic_hertz/_slic_hertz_d3.bme`                 |      2 |            14 |       728 / 755 |              0 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/33 RR_ogg/_9b.pms`                             |      2 |             9 |         52 / 60 |              0 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/33 RR_ogg/_9ex.pms`                            |      2 |             9 |       531 / 440 |              0 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/33 RR_ogg/_9h.pms`                             |      2 |             9 |       271 / 223 |              0 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/33 RR_ogg/_9n.pms`                             |      2 |             9 |       162 / 113 |              0 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_DPA.bms`  |      2 |            14 |       621 / 617 |            36 / 52 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_DPB.bms`  |      2 |            14 |         49 / 44 |            20 / 16 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_DPH.bms`  |      2 |            14 |       372 / 334 |            52 / 80 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_DPN.bms`  |      2 |            14 |       209 / 203 |            30 / 38 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_PME.pms`  |      2 |             9 |         48 / 30 |             12 / 8 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_PMEX.pms` |      2 |             9 |       643 / 515 |            28 / 50 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_PMH.pms`  |      2 |             9 |       413 / 309 |            62 / 74 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_PMN.pms`  |      2 |             9 |       239 / 173 |            34 / 34 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_SPA.bms`  |      2 |             7 |        1179 / 0 |             80 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_SPB.bms`  |      2 |             7 |         106 / 0 |             36 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_SPH.bms`  |      2 |             7 |         788 / 0 |            126 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_SPI.bms`  |      2 |             7 |        1994 / 0 |             78 / 0 |

## Be-Music policy implications

These are proposed compatibility rules, not claims about every native player:

- Retain the current OFF default. Offer an explicit HEADER/AUTO opt-in if implementing literal header selection. The corpus contradicts silently making header selection the default.
- Explicit OFF must stay OFF. Explicit TWO-PLAYER or other conversions remain explicit user choices, checked against existing ruleset/layout/course availability. A header must not silently turn beatoraja's one-player BATTLE into LR2's two-player BATTLE.
- In header mode, PLAYER2 needs a genuine beat 10/14KEY two-bank layout; PMS9 and an SP-only source must not become copied two-player charts. The seven author-labeled DP charts still require user intent via that explicit header mode.
- PLAYER4 on a beat SP source can use the same-chart two-player duplicate path as a documented Be-Music interpretation consistent with observed BATTLE. Primary evidence is insufficient to discard authored 2P notes on a DP source: diagnose that ambiguous case unless further evidence resolves it.
- Keep the existing course restrictions. Do not implicitly change the number of players or carry two independent player results into a one-player course.

## Replay compatibility

Current [browser preparation](../../packages/player-browser/src/session/play/play-chart.ts) and [engine option assembly](../../packages/player-browser/src/session/play/play-engine.ts) explicitly use the replay/fixed-arrangement's `play.battleMode ?? 'OFF'`. [Replay parsing](../../packages/player-engine/src/replay/format.ts) leaves an absent field absent. [Server simulation](../../packages/player-engine/src/replay/simulate.ts) consumes recorded canonical notes and lane mode rather than parsing the source header again. Preserve those boundaries: an old replay recording OFF, or lacking battle mode, must not acquire header inference after an upgrade. Record the effective new execution separately from any user-facing HEADER/AUTO request, so a saved replay reconstructs precisely the player count and arrangement it originally judged.

Temporary inspection outputs are `/tmp/player-header-corpus.json` (all 20 filenames, hashes verified, layout and object counts), `/tmp/player-header-layouts.mjs` (parser/model cross-check), `/tmp/player-header-bm98.chm`, `/tmp/player-header-bm98-manual/` and `/tmp/player-header-OpenLR2.cpp`. Existing corpus/manifests were not modified.

The implemented decision is [ADR 0028](../adr/0028-player-header-selection.md): AUTO remains opt-in; explicit COUPLE also permits an empty second side without copying; PLAYER4 double-side content is preserved as Be-Music policy rather than claimed native parity.
