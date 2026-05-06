[English version](./README.md)

# 仕様書

このディレクトリは、`be-music` リポジトリで使う仕様を Markdown でまとめたものです。

- [BMS 実装仕様](bms-spec.ja.md)
- [BMSON 実装仕様](bmson-spec.ja.md)
- [Bemuse 実装仕様](bemuse-spec.ja.md)
- [Player 実装仕様](player-spec.ja.md)
- [Browser player 実装メモ](player-web.ja.md)
- [BMS/BMSON 中間表現 (`@be-music/json`) 実装仕様](json-spec.ja.md)
- [用語集](glossary.ja.md)

補足:

- 公式仕様そのものではなく、**このリポジトリの実装がどう解釈するか**を優先して記述しています。
- 公式仕様と齟齬が出る場合は、まず実装方針を決めてからこのドキュメントを更新してください。
- これらの文書は現在の実装に集中させます。過去の判断は pull request、commit message、changelog に残してください。
- `@be-music/json` は pure IR、`@be-music/chart` は beat 解決やイベント順序などの譜面意味論を担当します。
