[English](./bmson-unknown-fields.md)

# bmson の未知フィールド: 根拠と保持の範囲

#837 のために 2026-10-31 調査。実行コードや既存の調査 manifest は変更しません。

## 公式仕様

[668c4338 の公式仕様](https://github.com/bemusic/bmson-spec/blob/668c4338cd7c64da2d2ec0f848c4ad58a3a881d9/doc/index.rst)は、JSON オブジェクトを Web IDL の dictionary で記述します。拡張に関する助言は、新モードでは基底の `version` を変えず `mode_hint` を変えること、新たな時刻クラスでは BPM/STOP の形と適切な単位に従うことです。未知キーの往復保持、任意フィールドの vendor prefix、書き出し時の競合解決は明示的に規定しません。したがって、未知の JSON を残すのは Be-Music の編集・相互変換の方針であり、bmson の再生上の必須要件を示すものではありません。`info.title_image` は概要の dictionary にはありませんが、本文に明示された公式の既知フィールドです。

仕様は、既知フィールドの不正値と省略を区別します。例えば `info.init_bpm` の欠落は致命的エラーで、`version` の null はエラーを示す必要があります。不透明な値の保持によって、この規則を回避したり未知の時刻クラスを実行したりしてはいけません。名前空間を持つ注釈オブジェクトは衝突回避の助言として妥当ですが、特定の prefix を公式要件として説明する根拠はありません。

## beatoraja の parser: 未知メンバーの扱いは階層によって異なる

本リポジトリの互換性資料と同じ [8108cd54 の jbms-parser](https://github.com/exch-bms2/jbms-parser/tree/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/bmson)を確認しました。以下はコードからの判断であり、実行による互換性試験ではありません。

| JSON の階層                          | Java クラス                 | コードが示す未知メンバーの扱い              |
| ------------------------------------ | --------------------------- | ------------------------------------------- |
| root                                 | `Bmson`                     | `@JsonIgnoreProperties(ignoreUnknown=true)` |
| `info`                               | `BMSInfo`                   | 同じ annotation                             |
| `lines[]`                            | `BarLine`                   | 同じ annotation。旧 `k` も宣言済み          |
| `bpm_events[]`、`stop_events[]`      | `BpmEvent`、`StopEvent`     | 同じ annotation                             |
| `sound_channels[]` とその `notes[]`  | `SoundChannel`、`Note`      | 同じ annotation                             |
| `bga` とその header・event           | `BGA`、`BGAHeader`、`BNote` | 同じ annotation                             |
| `scroll_events[]`                    | `ScrollEvent`               | 未知メンバーを無視する annotation なし      |
| `key_channels[]`、`mine_channels[]`  | `MineChannel`               | 同 annotation なし                          |
| その `notes[]`                       | `MineNote`                  | 同 annotation なし                          |
| `bga_sequence[]` とその `sequence[]` | `BGASequence`、`Sequence`   | 同 annotation なし                          |

[BMSONDecoder](https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java)は通常の `ObjectMapper` を生成して型付き DTO に読み込み、`IOException` では譜面を返しません。全体で未知メンバーを無視する設定や、任意のプロパティを保存する処理は見つかりませんでした。[Jackson 2.22.1](https://github.com/FasterXML/jackson-databind/blob/jackson-databind-2.22.1/src/main/java/com/fasterxml/jackson/databind/DeserializationFeature.java)では `FAIL_ON_UNKNOWN_PROPERTIES` が既定で有効であり、[jbms-parser のビルド設定](https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/build.gradle)はその依存系列を指定します。したがって annotation がない拡張階層では未知メンバーを拒否する場合があります。beatoraja が全階層の未知メンバーを一律に受理・保持・実行すると説明するのは誤りです。

decoder は既知メンバーをゲーム用の構造へ移します。往復編集の契約はありません。`Note.t`・`Note.up`・`BMSInfo.ln_type`・scroll events・BGA sequence/condition は既知の拡張であり、任意の注釈ではありません。共用する `MineNote.damage` は hidden note でも受理しますが、hidden note の decoder はレーンと pulse だけを読み、damage を地雷効果に使いません。

## 元の bmson 28ファイルを全階層で集計

`format-feature-usage.json` が記録するパスから全28ファイルを再読しました。SHA-256 はすべて一致しました。ノートや BGA event を含む、存在するオブジェクトの全階層を検査しました。**任意の未知メンバーは bmson 0/28（0.00%）、全譜面 0/2,748（0.00%）**でした。これはコーパスの集計結果であり、保持を確認する正例 fixture が不要になる根拠ではありません。

| 階層               | 検査したオブジェクト数 | 実際に存在したキー                                                                                                                                                                                                                   |
| ------------------ | ---------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| root               |                     28 | `bga`, `bpm_events`, `info`, `lines`, `sound_channels`, `version`。4ファイルに `key_channels`                                                                                                                                        |
| `info`             |                     28 | `artist`, `back_image`, `banner_image`, `chart_name`, `eyecatch_image`, `genre`, `init_bpm`, `judge_rank`, `level`, `ln_type`, `mode_hint`, `preview_music`, `resolution`, `subartists`, `subtitle`, `title`, `title_image`, `total` |
| `lines[]`          |                 35,778 | `y`                                                                                                                                                                                                                                  |
| `bpm_events[]`     |                     29 | `bpm`, `y`                                                                                                                                                                                                                           |
| `sound_channels[]` |                 30,488 | `name`, `notes`                                                                                                                                                                                                                      |
| 通常の音声 note    |                160,245 | `c`, `l`, `x`, `y`。91,509ノードに `t`, `up`                                                                                                                                                                                         |
| `bga`              |                     28 | `bga_events`, `bga_header`, `layer_events`, `poor_events`                                                                                                                                                                            |
| `bga_header[]`     |                     32 | `id`, `name`                                                                                                                                                                                                                         |
| `bga_events[]`     |                     28 | `id`, `y`                                                                                                                                                                                                                            |
| `poor_events[]`    |                      4 | `id`, `y`                                                                                                                                                                                                                            |
| `key_channels[]`   |                      4 | `name`, `notes`                                                                                                                                                                                                                      |
| hidden note        |                      4 | `damage`, `x`, `y`                                                                                                                                                                                                                   |

STOP・scroll・mine・layer event・BGA sequence・sequence frame のノードはありません。それらの未知フィールドの扱いは自作 fixture で試験する必要があります。既知拡張の存在を任意の未知キーとして数えてはいけません。`info.ln_type` は20ファイル（値2が18、値1が2）、`t`/`up` は13ファイルで、それぞれ全件が0/falseです。`title_image` は info 全28件にあり、14件が非空です。

### 既知だが実行しない hidden note の damage

次の各ファイルに、`thankyouforplaying.wav` のチャンネル内で `{damage:0,x:8,y:85200}` という hidden note が1件ずつあります。4ノードは保持の必要性を示しますが、**未知の vendor 注釈が4件あるという意味ではありません**。上流の共用 DTO は `damage` を認識しますが hidden note の再生は無視します。調査時点の Be-Music は hidden note の正規化で `keepDamage=false` として省略しています。不透明に保持する場合も地雷動作を生じさせてはいけません。

- `gdbg_bms_package_2025/GdbG BMS Package 2025/えびです_GRAYSCALE_ogg_bmson/GRAYSCALE_7Key_A.bmson`
- `gdbg_bms_package_2025/GdbG BMS Package 2025/えびです_GRAYSCALE_ogg_bmson/GRAYSCALE_7Key_H.bmson`
- `gdbg_bms_package_2025/GdbG BMS Package 2025/えびです_GRAYSCALE_ogg_bmson/GRAYSCALE_7Key_LN.bmson`
- `gdbg_bms_package_2025/GdbG BMS Package 2025/えびです_GRAYSCALE_ogg_bmson/GRAYSCALE_7Key_N.bmson`

## Be-Music の保持契約への提案

以下は要求された編集動作から導く実装要件であり、ネイティブの必須要件ではありません。

1. root・info・channel・note・barline・timing event・BGA container/header/event/sequence/frame など、保持する意味上の各ノードに JSON 値の map を深くコピーして付けます。可変の配列 index だけで関連付けず、sort や編集後も注釈をノードとともに移動します。
2. 既知フィールドを正とします。不正値を捨てたり既定化したりする場合も、対応済みの外部キーを予約します。不透明な map から不正な既知プロパティが復活したり、検証を回避したり、編集済みの正規化値を上書きしたりしてはいけません。
3. null・配列・オブジェクト・スカラーを含む入れ子の JSON を、元オブジェクトを共有せず値として保持します。JavaScript の prototype のメンバーと同名のプロパティもデータとして扱います。文字列をスクリプト・リソースパス・命令・時刻変更・判定 modifier として実行しません。
4. 対応済みの vendor フィールドは型付きの経路で保持します。他のデータは不透明に保持し、ネイティブの拡張を実行するとは主張しません。任意の注釈を再生や意味上の譜面 fingerprint に混ぜません。
5. 対象は**有効な正規化済みノード**であると明記します。拒否したレコード、コメント、重複 JSON キー、元の空白、数値の字面、parser の数値表現を超える精度の復元は保証しません。ノードを削除すると注釈も削除します。正規化 writer は既知の内容を並べ替えたり標準形に直したりできます。

一時資料は `/tmp/bmson-unknown-corpus-scope-keys.json`（階層・キー・型の件数と全ファイルの hash 照合）、`/tmp/bmson-unknown-primary/bmson-spec.rst`、`/tmp/bmson-unknown-primary/jbms-parser-8108cd54a19275810e1f5d2c9586f008eb6db95e/` 以下の固定版 parser ソースです。元ファイルと既存の調査データは変更していません。
