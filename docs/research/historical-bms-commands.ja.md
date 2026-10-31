# 歴史的な BMS 方言コマンド

[English](./historical-bms-commands.md)

[#837](https://github.com/nulltask/be-music/issues/837) に挙げた歴史的な方言コマンドを、出自・対応プレイヤー・実際の使用状況で分類し、Be-Music での扱いを記録します。[player 仕様](../player-spec.ja.md#一部対応未対応コマンド)の「一部対応・未対応コマンド」表の根拠です。

## 資料

- コマンドの説明・出自・対応一覧：hitkey の [BMS command memo](https://hitkey.nekokan.dyndns.info/cmds.htm)（2026-10-31 時点で本サイトに接続できなかったため、[Web Archive の写し](https://web.archive.org/web/2024/https://hitkey.nekokan.dyndns.info/cmds.htm)で確認）。アンカーは各コマンドの行に示します。
- Be-Music の挙動：`packages/chart-parser/src/core/bms-headers.ts`（`pushHeaderLine`）と `packages/chart-writer/src/bms.ts`。
- 使用状況：手元のテスト用コーパスを行頭で走査しました。対象は **BMS 系 5,344 ファイル（SHA-256 で一意なもの 5,142）** です。#822 の集計で使った BMS Starter Pack と gdbg パッケージ 2022〜2025（2,720 ファイル）に、作家別・イベント別のコレクションを加えています。bmson は対象外です。譜面はコミットしません。

## 現在の parser の挙動

`#EXBPMxx`（後続対応を参照）を除き、以下のコマンドには専用の解析処理がありません。値が空でなければ `pushHeaderLine` の default 分岐に入り、大文字化したコマンド名で `metadata.extras` にそのまま保持されます（`#ExtChr` は `EXTCHR`）。BMS writer は `metadata.extras` をヘッダー行として書き戻すため、BMS と Be-Music JSON の往復で失われません。player・renderer・fingerprint はこれらを参照しません。`#MATERIALS`・`#DIVIDEPROP`・`#VIDEOFILE` は専用の `bms` フィールドを持ちますが、「保持のみ・実行なし」である点は同じです。

## 分類

| コマンド                                                                      | 出自 → 対応（cmds）                                                        | 意味                                                                                                  | コーパスでの使用（ファイル）    | 判断                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#SONGxx`（[`SONGXX`][s]）                                                    | pomu → pomu2。Sonorous は解析のみ。廃止扱い                                | チャンネル `99` 用 `#TEXTxx` の旧名。同じ番号を両方で定義すると `#TEXTxx` が優先                      | 0 / 5,344                       | 未対応。使用例のない廃止済みの別名で、機能は `#TEXTxx` が担う。`metadata.extras` に保持                                                                                                               |
| `#EXBPMxx`（[`EXBPMXX`][e]）                                                  | nanasi → nanasi、pomu2、PMSee-V、Sonorous、BGAEncAdv、TechnicalGroove、HDX | チャンネル `08` 用 `#BPMxx` の完全な別名。`#BPMxx` と `#BPM` を混同する BMSC の不具合を避けるため導入 | 0 / 5,344                       | **実装済み**。時刻に影響し、対応プレイヤーが多く、実装も小さい。parser は `#BPMxx` として保存する（後続対応を参照）。以前は `#EXBPMxx` だけが定義するチャンネル `08` が未定義参照として捨てられていた |
| `#CHARFILE`（[`CHARFILE`][c]）                                                | pomu → pomu2、PMChr-V。Sonorous と TechnicalGroove は解析のみ              | ポップン風キャラクターアニメーション（`.chp`）                                                        | 0 / 5,344                       | 未対応。譜面の意味の外にある演出素材で、プレイ画面のキャラクターは Be-Music のスキンが担う                                                                                                            |
| `#ExtChr`（[`EXTCHR`][x]）                                                    | BM98 → BM98k、DDR（一部）                                                  | BM98 のプレイ画面スプライトを `#BMP` 画像の一部で置き換える。チャンネル `05` で切り替え可能           | **2 / 5,344**（1 作品の SP/DP） | 未対応。スプライト番号は BM98 内部のキャラクターマップを指し、Be-Music・LR2・beatoraja のスキンに対応物がない。2 ファイルともチャンネル `05` は使っていない                                           |
| `#CDDA`（[`CDDA`][d]）                                                        | DDR → DDR                                                                  | 音楽 CD のトラックを BGM として再生                                                                   | 0 / 5,344                       | 未対応。ブラウザーは音楽 CD を読めず、音源も譜面フォルダーの外にある                                                                                                                                  |
| `#VIDEOf/s`（[`VIDEOFPS`][v]）                                                | bemaniaDX → bemaniaDX                                                      | `#VIDEOFILE` の再生フレームレート                                                                     | 0 / 5,344                       | [#836](https://github.com/nulltask/be-music/issues/836)（`#VIDEOFILE` アダプター）に含める。単独では意味がない                                                                                        |
| `#VIDEODLY`（[`VIDEODLY`][v]）                                                | bemaniaDX → bemaniaDX                                                      | `#VIDEOFILE` の開始フレーム（遅延）                                                                   | 0 / 5,344                       | 同上、#836 に含める                                                                                                                                                                                   |
| `#VIDEOCOLORS`（[`VIDEOCOLORS`][v]）                                          | bemaniaDX → bemaniaDX                                                      | AVI パレットの色深度                                                                                  | 0 / 5,344                       | 未対応。出力形式は現代のデコーダーが決めるため、再現すべき効果がない                                                                                                                                  |
| `#SEEKxx`（[`SEEKXX`][k]）                                                    | LR → LR。LR2 で削除された可能性あり。cmds でも詳細不明                     | チャンネル `05` で現在の動画の再生位置をミリ秒単位で移動                                              | 0 / 5,344（チャンネル `05`：0） | 未対応。信頼できる仕様も使用例もない                                                                                                                                                                  |
| `MATERIALS`（[`MATERIALS`][m]）                                               | BM98de → BM98de、RDM、bemaniaDX、nanasi 1.00 未満                          | ヘッダーではない。`#WAVxx <folder> file` をプレイヤー実行ファイル横の `Materials` フォルダーから解決  | 0 / 5,344（`<folder>` 参照）    | 未対応。Be-Music には実行ファイル基準の共有フォルダーがなく、譜面は自己完結している必要がある。Be-Music が `bms.materials` に保持する `#MATERIALS` ヘッダーはこの機能ではない                         |
| `#MATERIALSBMP` / `#MATERIALSWAV`（[`MATERIALSBMP`][m]、[`MATERIALSWAV`][m]） | nanasi 1.00 未満 → nanasi 1.00 で削除。廃止扱い                            | 全画像／全音声定義の既定 `Materials` サブフォルダー                                                   | 0 / 5,344                       | 未対応。理由は `MATERIALS` と同じ                                                                                                                                                                     |
| `#DIVIDEPROP`（[`DIVIDEPROP`][p]）                                            | nanasi 0.98 未満 → 削除。廃止扱い                                          | nanasi の小節分解能                                                                                   | 0 / 5,344                       | 意図的に何もしない。Be-Music はオブジェクト位置を厳密な分数で扱うため、分解能の指定で変わるものがない。`bms.divideProp` に保持                                                                        |

走査では `#BASEBPM` も **12 / 5,344** ファイルで見つかりました。これは HS-FIX の基準 BPM として既に実行されており、対応コマンドの表に載せています。

## 後続対応

- `#EXBPMxx`（対応済み）：制御構文の別表記と同じく、parser が入力時に `#BPMxx` へ書き換える。そのためファイル順の規則・分岐・fingerprint・書き出しは両者を一つの定義として扱い、同じ番号では後の行が勝つ。`metadata.extras` に保持していた旧 Be-Music JSON は、`#BPMxx` がその番号を定義していなければ `resources.bpm` へ移行する。[フォーマット互換性](../format-compat.ja.md)を参照。
- `#VIDEOf/s`／`#VIDEODLY`：#836 の `#VIDEOFILE` アダプターの一部として扱う。

それ以外は未対応のままとし、往復で失わないよう `metadata.extras` に保持するだけで、実行時の意味は持たせません。

[s]: https://hitkey.nekokan.dyndns.info/cmds.htm#SONGXX
[e]: https://hitkey.nekokan.dyndns.info/cmds.htm#EXBPMXX
[c]: https://hitkey.nekokan.dyndns.info/cmds.htm#CHARFILE
[x]: https://hitkey.nekokan.dyndns.info/cmds.htm#EXTCHR
[d]: https://hitkey.nekokan.dyndns.info/cmds.htm#CDDA
[v]: https://hitkey.nekokan.dyndns.info/cmds.htm#VIDEOFPS
[k]: https://hitkey.nekokan.dyndns.info/cmds.htm#SEEKXX
[m]: https://hitkey.nekokan.dyndns.info/cmds.htm#MATERIALS
[p]: https://hitkey.nekokan.dyndns.info/cmds.htm#DIVIDEPROP
