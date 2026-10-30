[English](./player-header-modes.md)

# PLAYER ヘッダと二人用モードの選択

#837 のために 2026-10-31 調査。この資料では実行コードを変更しません。

## ネイティブの一次資料と確認範囲

[やねうらおの原仕様](https://bm98.yaneu.com/bm98/bmsformat.html)は 1=Single、2=Two、3=Double を定義し、11–17 と 21–27 を各プレイ側のチャンネルに割り当てます。値 4 は定義しません。

[2001-12-25 保存の BM98k 公式サイト](https://web.archive.org/web/20011225152255/http://bm98.cup.com/main.htm)は[公式の CHM マニュアル](https://web.archive.org/web/20011007035736/http://bm98.cup.com/bm98_k.chm)にリンクしています。その `14.html` は 1=SinglePlay、2=CouplePlay、3=DoublePlay、4=BattlePlay と明記します。`08.html` はロード中に BattlePlay・DoublePlay を強制するユーザー操作を説明し、BMS で BP/DP を指定済みの場合には機能しないとします。ただし、独立して配置された 2P オブジェクトを PLAYER4 がどう扱うかは説明しません。実行ファイルを起動せず CHM を読みました。

[命令の観測資料](https://hitkey.nekokan.dyndns.info/cmdsJP.htm#PLAYER)は、COUPLE を各プレイヤーが各側を演奏する別ゲージのモード、BATTLE を同一の一人用譜面を二人が競う別ゲージのモードとして区別します。PLAYER4 の複製に関する説明は観測資料であり、原仕様に確定した 2P 配置の上書き規則ではありません。独立した 2P ノートを持つ PLAYER4 の扱いは、調べた一次資料では未確定です。

現代の一次資料も、ヘッダだけで配置を上書きできない理由を示します。nanasigroove の `_RESOURCE/11_1_bms.html` は PLAYER 非対応です。charatbeatHDX の `FILES/html/06.html` は PLAYER 非対応で、オブジェクトの有無から SP/DP を判断します。それぞれ[公式の nanasigroove 配布物](https://web.archive.org/web/20131228034524/http://d11x.sakura.ne.jp/software/nanasigroove/nanasi_1552_full.zip)と[公式の HDX 配布物](https://web.archive.org/web/20211214030536/http://www.charatsoft.com/software/download/charatbeatHDX_v1.18.zip)を保存した書庫内の資料です。

## 実際のコーパス: ヘッダの件数は再生不具合の件数ではない

既存の manifest が抽出した 20 ファイルを再読し、全 SHA-256 が一致しました。内容の異なる 20 ファイルで、**PLAYER2=20、PLAYER4=0** です。内訳は Starter Pack 1、GdbG2022 3、GdbG2023 0、GdbG2024 16、GdbG2025 0。**BMS 20/2,720=0.74%**、全譜面 **20/2,748=0.73%** です。PLAYER4 の実際の動作をこのコーパスから推測できません。

現在の parser/model に実際の拡張子を渡すと、**PMS-STD 9KEY が8、SP 7KEY が4、DP 14KEY が7、DP 10KEY が1** です。PMS の 22–25 は一人用の九鍵配置の一部であり、二人目の証拠にはなりません。SP の4ファイルには非ゼロの 2P 通常・LN オブジェクトがありません。DP 配置8ファイル中7ファイルは、subtitle や作者の readme に DP と明記します。配置で絞っても PLAYER2 の自動選択は、作者が DP と記した7譜面を二人用に変えてしまいます。

残る 10KEY の `roop_inasummerday_tp.bms` には、作者の readme で DP と 2P の譜面を別に担当した記述があり、別の `_dp.bms` もあります。これは実際の二人用譜面の存在を裏付けますが、現代の全 PLAYER2 ヘッダを同じ意味として扱う根拠にはなりません。

Umikaze Moment の同梱 `_readme.txt` は SP 5譜面、DP 4譜面、9key 4譜面を分け、LR2/beatoraja での動作確認を記します。下記の SP 4ファイルは、明示的な SP subtitle と 2P 配置がない構造にもかかわらず PLAYER2 です。別の作者が担当した SP NORMAL は PLAYER1 です。ここから譜面種別は確認できますが、なぜ PLAYER2 を記したかは不明です。編集・テンプレート由来という推測を作者が述べた事実として扱わないでください。

表の数値は非ゼロの通常オブジェクトと LN 始終端オブジェクトの数です。判定ノート数ではなく、LN の組み合わせや重複解決で判定対象数は変わります。ファイルパスは `~/Downloads/bms` からの相対パスです。

| ファイル                                                                                    | PLAYER | 解決した鍵数 | 通常 1P / 2P | LN オブジェクト 1P / 2P |
| ------------------------------------------------------------------------------------------- | -----: | -----------: | -----------: | ----------------------: |
| `BMS_Starter_Pack/2007/roop_-_in_a_summer_day/roop_inasummerday_tp.bms`                     |      2 |           10 |    240 / 240 |                   0 / 0 |
| `gdbg_bms_package_2022/GdbG BMS Package 2022/qfeileadh_MESMERA/_MESMERA_11_DPE.bms`         |      2 |           14 |    124 / 129 |                   6 / 4 |
| `gdbg_bms_package_2022/GdbG BMS Package 2022/qfeileadh_MESMERA/_MESMERA_13_DPN.bms`         |      2 |           14 |    718 / 685 |                 44 / 38 |
| `gdbg_bms_package_2022/GdbG BMS Package 2022/slic_hertz/_slic_hertz_d3.bme`                 |      2 |           14 |    728 / 755 |                   0 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/33 RR_ogg/_9b.pms`                             |      2 |            9 |      52 / 60 |                   0 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/33 RR_ogg/_9ex.pms`                            |      2 |            9 |    531 / 440 |                   0 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/33 RR_ogg/_9h.pms`                             |      2 |            9 |    271 / 223 |                   0 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/33 RR_ogg/_9n.pms`                             |      2 |            9 |    162 / 113 |                   0 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_DPA.bms`  |      2 |           14 |    621 / 617 |                 36 / 52 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_DPB.bms`  |      2 |           14 |      49 / 44 |                 20 / 16 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_DPH.bms`  |      2 |           14 |    372 / 334 |                 52 / 80 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_DPN.bms`  |      2 |           14 |    209 / 203 |                 30 / 38 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_PME.pms`  |      2 |            9 |      48 / 30 |                  12 / 8 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_PMEX.pms` |      2 |            9 |    643 / 515 |                 28 / 50 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_PMH.pms`  |      2 |            9 |    413 / 309 |                 62 / 74 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_PMN.pms`  |      2 |            9 |    239 / 173 |                 34 / 34 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_SPA.bms`  |      2 |            7 |     1179 / 0 |                  80 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_SPB.bms`  |      2 |            7 |      106 / 0 |                  36 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_SPH.bms`  |      2 |            7 |      788 / 0 |                 126 / 0 |
| `gdbg_bms_package_2024/GdbG BMS Package 2024/[wakadori+saaa]Umikaze Moment/UmiMen_SPI.bms`  |      2 |            7 |     1994 / 0 |                  78 / 0 |

## Be-Music の方針への示唆

以下は互換性のための提案であり、全ネイティブプレイヤーの挙動の主張ではありません。

- 現行の OFF を既定として維持します。ヘッダを文字どおり使う場合は、明示的な HEADER/AUTO の選択を用意します。黙ってヘッダ優先を既定にすることはコーパスの証拠と矛盾します。
- 明示した OFF は OFF のままにします。TWO-PLAYER や他の変換の明示指定は既存の ruleset・配置・コース制約で確認します。ヘッダによって beatoraja の一人用 BATTLE を LR2 の二人用 BATTLE に変えてはいけません。
- ヘッダモードでの PLAYER2 は、実際に両側を持つ beat 10/14KEY に限定します。PMS9 や SP だけの譜面を複製して二人用にしてはいけません。作者が DP と記した7譜面も、ヘッダモードを明示的に選ぶことが必要です。
- beat SP の PLAYER4 は、観測上の BATTLE と整合する Be-Music の解釈として、同一譜面を二人用に複製する既存経路を使えます。DP の既存 2P ノートを破棄してよいという一次資料の裏付けは足りないため、追加の証拠が出るまでは曖昧なケースとして診断します。
- 既存のコース制約を維持します。一人用コースで黙って人数を変更したり、独立した二人分の結果を混ぜたりしません。

## replay の互換性

現在の [browser の前処理](../../packages/player-browser/src/session/play/play-chart.ts)と[engine オプションの組み立て](../../packages/player-browser/src/session/play/play-engine.ts)は、replay/fixed arrangement の `play.battleMode ?? 'OFF'` を明示的に使います。[replay の解析](../../packages/player-engine/src/replay/format.ts)は未指定を未指定のまま保持します。[サーバーのシミュレーション](../../packages/player-engine/src/replay/simulate.ts)は保存済みのノートと lane mode を使い、ソースのヘッダを再解析しません。この境界を維持し、OFF を記録した古い replay や battle mode のない replay に、新しいヘッダ推論を適用しないでください。画面上の HEADER/AUTO という選択と実際に適用したモードを分けて記録し、元の判定人数と配置を正確に再構築する必要があります。

一時資料は `/tmp/player-header-corpus.json`（20ファイルのパス・hash 確認・配置・オブジェクト数）、`/tmp/player-header-layouts.mjs`（parser/model の照合）、`/tmp/player-header-bm98.chm`、`/tmp/player-header-bm98-manual/`、`/tmp/player-header-OpenLR2.cpp` にあります。既存のコーパスや manifest は変更していません。

実装上の決定は [ADR 0028](../adr/0028-player-header-selection.ja.md) に記録します。AUTO は明示的な選択とし、COUPLE は空の2P側も複製せずに保持します。PLAYER4 の二側配置はネイティブとの一致を主張せず、Be-Music の方針として保持します。
