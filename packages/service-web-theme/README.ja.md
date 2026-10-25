[English](./README.md)

# サービスのテーマ

Accounts と Dashboard 用の非公開スタイルシートです。`src/theme.css` は Tailwind CSS v4 と [Basecoat](https://basecoatui.com)（Leaderboard と同じ部品。shadcn/ui は依存に入れません）を読みます。`pnpm --filter @be-music/service-web-theme run build:css` が `src/styles.generated.ts` を書き、`prepare` がインストール時に再生成します。ページは Basecoat の class（`btn`、`card`、`input`）と Tailwind のユーティリティを使います。

暗い配色はシステムの配色に従います。Leaderboard はスクリプトで `.dark` を付けますが、これらのページはコンテンツセキュリティポリシーがインラインスクリプトを拒むため、ビルドが Basecoat の暗いトークンを `prefers-color-scheme` の下に繰り返します。

非公開の寄付サイトは `src/service-theme.ts` に独自のコピーを持つため、このスタイルシートを変えるときは別途更新します。プレイヤーはスキンによる独自の UI を持ち、このテーマを使いません。

`renderServiceHeader` は Play 以外のサービスのヘッダです。ログイン中のユーザー、Play へのリンク、English / 日本語を出します。言語は `resolveLocale` が `?lang=`、`be-music-lang` クッキー、`Accept-Language` の順で決めます。

サービスのフッタには `renderBuildInfo({ builtAt, revision })` を使います。ビルド時に固定した ISO 日時を UTC で、ソースの revision を 8 桁で表示し、完全な revision は title に残します。ビルド処理が実際のチェックアウトから取得し、リクエスト処理では日時を生成しません。
