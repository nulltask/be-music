[English](./bmson-zero-total.md)

実装済みの方針は [ADR 0030](../adr/0030-bmson-zero-total.ja.md) を参照。以下の実装状況は調査時点のもの。

# bmson の TOTAL ゼロを任意で解釈する方針

#837 の調査。2026-10-31、Be-Music `c3b783a5` を確認した。この文書は再生時に明示選択する方針の提案であり、既存の beatoraja 互換既定値を変更しない。

## 仕様とネイティブ実装

[公式 bmson 仕様の固定リビジョン](https://github.com/bemusic/bmson-spec/blob/668c4338cd7c64da2d2ec0f848c4ad58a3a881d9/doc/index.rst#information-object-bmsoninfo) は `info.total` を相対的なゲージ回復量と定義する。省略時は 100、負値は絶対値、ゼロはゲージが増加しない。標準回復量とダメージへの利用はプレイヤーに依存する。ゼロだからゲージを初期化したり、ダメージを無効にしたり、クリアを保証したりする規則ではない。コースの持ち越し、ゲージ選択、ランキング、ゼロ時のダメージ式は規定されていない。

上流の [BMSONDecoder](https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java) は正値だけを TOTAL に設定し、それ以外は警告する。[BMSModel](https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSModel.java) の初期値は BMSON 単位の 100 なので、元ファイルのゼロはゼロとして再生へ届かない。Be-Music のパーサーは既にゼロを保持し、負値を絶対値へ正規化するため、負値の扱いもこの上流デコーダーと異なる。

[BMSPlayerRule.validate](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/BMSPlayerRule.java) は正の bmson 比率を既定の絶対 TOTAL に掛け、非正値は既定値に置換する。既定値は beat/popn 系では `max(260, 7.605*N/(0.01*N+6.5))`、keyboard 系では `max(300, 7.605*(N+100)/(0.01*N+6.5))`。いずれも `N=0` で有限になる。

[GrooveGauge](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/GrooveGauge.java) はゲージ表に TOTAL 補正を適用し、並行するゲージも更新する。TOTAL 補正と HARD 回復補正にはノート数による除算があり、ゼロ件の保護はない。その算術を有限値の契約としてそのまま移植すべきではない。コースでは class 表を選び、前ステージのゲージ履歴を復元する。譜面の TOTAL は持ち越した HP を消す命令にはなっていない。

[GaugeProperty](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/GaugeProperty.java) には TOTAL 非依存の正の回復がある。class と HAZARD は補正なし、LR2 HARD はダメージのみを補正する。絶対 TOTAL をゼロにするだけでは全ゲージに対応できない。例えば 7 鍵 CLASS の PGREAT 回復は 0.15、LR2 HARD は 0.1 である。

## 元ファイルの使用状況

既存の[監査マニフェスト](./format-feature-usage.json) にある bmson 28 ファイルを `~/Downloads/bms/BMS_Starter_Pack` と同階層の `gdbg_bms_package_20xx` から再読込した。SHA-256 は全 28 件で一致した。以下はパーサー正規化前の JSON 値であり、分母はノート数ではなくファイル数。

| 元の `info.total`   | ファイル数 | bmson 28 件中 |
| ------------------- | ---------: | ------------: |
| ゼロ                |          0 |         0.00% |
| 負値                |          0 |         0.00% |
| 省略                |          0 |         0.00% |
| null または不正な型 |          0 |         0.00% |
| 100                 |         15 |        53.57% |
| その他の正値        |         13 |        46.43% |

値の分布は `61×1, 78.9×1, 95.3×1, 100×15, 135×1, 155×2, 160×1, 165×1, 170×1, 200×1, 235×1, 255×1, 270×1`。ゼロは全譜面でも **0/2,748 件（0.00%）**。このコーパスに実際のゼロ使用例はないため、任意選択時の検証には専用のテスト譜面が必要になる。

## Be-Music の実装箇所

以下は上流の事実と区別した、リポジトリー内の調査結果。

- [パーサー](../../packages/chart-parser/src/core/bmson.ts) は有限のゼロを保持し負値を絶対値にする。[文書の正規化](../../packages/chart-parser/src/core/bmson-document.ts) は省略時に 100 を補う。ゼロを省略扱いに変換しない。
- [解決済み譜面](../../packages/chart-model/src/resolved-chart.ts) と [ruleset への変換](../../packages/player-engine/src/ruleset/chart-facts.ts) は値と `absolute`/`percent` 単位を保持する。BMS/bmson 混在 NONSTOP は `totalUnit` を運ぶため、`sourceFormat === 'bmson'` だけでは bmson コンテナー内の BMS TOTAL を誤判定する。
- [ruleset 定義](../../packages/player-engine/src/ruleset/definitions.ts) が実効 TOTAL、選択中・代替・並行ゲージ表、PRACTICE 上書き、プレイ単位の選択を集約する。現状の `raw <= 0` フォールバックが互換動作を維持している。That-Which-Must-Not-Be-Named の通常ゲージや[コースの class ゲージ](../../packages/player-engine/src/ruleset/course.ts) は、回復すべてを TOTAL から導出していない。
- [RulesetGauge](../../packages/player-engine/src/ruleset/gauge.ts) は判定増減と HCN の倍率を全ゲージへ適用する。[判定の初期化](../../packages/player-engine/src/core/bootstrap.ts) でも HCN は同じ表を通り、地雷の直接ダメージは迂回する。表の正値だけをゼロにすれば通常判定と HCN 保持回復を止めつつ、HCN 解放ダメージ、地雷、死亡判定を維持できる。公開 API の `applyRawDelta` に将来正の回復経路を追加する際も、この方針を守る必要がある。
- [replay 形式](../../packages/player-engine/src/replay/format.ts)、[記録](../../packages/player-engine/src/replay/recorder.ts)、[replay ruleset 変換](../../packages/player-engine/src/replay/rulesets.ts) は TOTAL と単位を持つが解釈の選択は記録しない。任意のプレイ設定を追加し、省略をすべての実行・シミュレーション・コース経路で既存の互換動作に固定する。
- [NONSTOP 合成](../../packages/player-engine/src/course/nonstop/compose.ts) は元ステージから一つの実効 TOTAL を選ぶ。合成譜面へ不用意にステージ別ゼロ切替を導入しない。独立したコースステージは、持ち越しや並行ゲージ履歴を維持して各ステージのゼロを解決できる。

## 推奨する任意選択の契約

以下は **Be-Music 独自の方針案**であり、ネイティブ実装の説明ではない。

1. 例えば `bmsonTotalMode: 'beatoraja' | 'spec'` のような、検証可能なプレイ単位の選択を追加する。既定値は `beatoraja`。古い replay の省略値は閲覧者の設定に依存させず、この定数で解決する。明示選択をホスト、設定、コース、記録、読込、サーバー検証まで伝える。
2. `spec` のゼロ解釈は、正規化済みの **比率単位**の TOTAL がゼロの場合だけ有効にする。BMS の絶対値ゼロは従来の既定値を使う。直接 replay/facts を受け取る境界でも負値を絶対値にするか、不正な負値を一貫して拒否する。パーサーだけでは直接 API を保護できない。
3. 回復無効とダメージ用の絶対 TOTAL を分ける。ダメージと診断には通常の既定 TOTAL を残し、回復無効を別に公開して、完成した選択中・代替・全並行ゲージ表の正の増減量をゼロにする。負の増減量、guts、初期 HP、ボーダー、下限、死亡状態、持ち越しは維持する。互換既定値のダメージを使う方針は仕様の許容範囲であり、HARD ダメージの別変更を避けられる。
4. コースと PRACTICE の表を構築した後にも同じ規則を適用する。PRACTICE が TOTAL を明示上書きした場合は設定値を優先し、正値なら回復を有効にする。上書きがなければ元のゼロによる回復無効を維持する。PRACTICE の開始値とコース持ち越しは判定回復ではなく初期条件とする。形式仕様が定めない優先順位なので文書化する。
5. エンジンの現状どおりノート数の除数を正に保護する。ノートゼロでも有限値を返し、初期値・持ち越しと既存のクリア／失敗規則を維持する。TOTAL ゼロだけを理由に特別な失敗を追加しない。
6. 譜面とプレイ内容の fingerprint は変更しない。解釈はプレイ設定である。任意選択した手動プレイも通常どおり保存・検証する。ゲージ動作が変わる場合は、解釈別にベスト記録と Leaderboard の比較を分け、影響するステージを含む混在コースも対象にする。比較区分が未整備の間は理由を明示して保存するランキング対象外とし、通常のベスト記録へ統合しない。これは結果の扱いを定義した対応済み再生であり、未対応機能として拒否することではない。正の TOTAL で動作が変わらない任意選択は比較区分を分ける必要がない。

[replay の適格性](../../packages/player-engine/src/replay/eligibility.ts) が現在認識するランキング対象外理由は tempo/course-stage のみで、[ベスト記録](../../packages/player-engine/src/records/best-record.ts) は譜面／コースと判定 ruleset ごとに一つを想定する。シミュレーションだけを直すと比較の整合性が欠ける。送信を正しく分類するには、サーバー検証と表示も設定を理解する必要がある。黙って既定値でシミュレーションすると別のプレイを検証してしまう。[Leaderboard の契約](../leaderboard.ja.md)も参照。

## 必要な検証

正値・ゼロ・省略・負値とモード明示／省略、混在コンテナー内の BMS 絶対値ゼロ、固定回復の HARD/HAZARD/class を含む全ゲージ系統、選択中・代替・全並行ゲージ、HCN 保持／解放、地雷、ノートゼロ、PRACTICE TOTAL の優先順位、持ち越し、独立コースと合成 NONSTOP の違い、古い replay の省略、直列化と不正モード拒否、実行／replay／サーバーの決定的な一致、ベスト記録と Leaderboard の分類を検証する。既定モードでは元コーパスの TOTAL と fingerprint を変更しない。この調査ではランタイムを変更していない。

## 実装後の検証

元ファイル 28 件のハッシュがすべて一致した。3 ルールセット・308 通りのゲージ設定で互換モードと仕様モードを比較し、正の TOTAL の動作が変わらないことを確認した。対象は解決済みノート 39,999 件・サンプルトリガー 160,249 件で、元 JSON と chart/play fingerprint も変わらない。構造・ゲージの検証であり、全メディアの実再生ではない。TOTAL 0 の実行は自作 fixture で確認する。
