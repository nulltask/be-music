[English](./README.md)

# サービスのテーマ

Accounts と Dashboard 用の非公開 CSS 基盤です。`SERVICE_CSS` は [shadcn の neutral デザイントークン](https://ui.shadcn.com/docs/theming) を使います。使うのは CSS 変数だけで、shadcn/ui の部品ライブラリは依存に入れません。システムフォント、幅 64rem のレイアウト、これまでの操作部品の寸法はそのままです。これらのページはテーマ用の class を持たないので、暗い配色はシステムの配色に従います。キーボードのフォーカス表示、本文へのスキップリンク、レスポンシブなヘッダーを含みます。

Leaderboard は Basecoat 経由で同じトークン名を使います。非公開の寄付サイトは `src/service-theme.ts` にコピーを持つため、このスタイルシートを変えるときは一緒に更新します。プレイヤーはスキンによる独自の UI を持ち、このテーマを使いません。

`renderServiceHeader` は Play 以外のサービスのヘッダです。ログイン中のユーザー、Play へのリンク、English / 日本語を出します。言語は `resolveLocale` が `?lang=`、`be-music-lang` クッキー、`Accept-Language` の順で決めます。

サービスのフッタには `renderBuildInfo({ builtAt, revision })` を使います。ビルド時に固定した ISO 日時を UTC で、ソースの revision を 8 桁で表示し、完全な revision は title に残します。ビルド処理が実際のチェックアウトから取得し、リクエスト処理では日時を生成しません。
