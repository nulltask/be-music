[English version](./README.md)

# @be-music/leaderboard-api

be-music の Leaderboard API です。Cloudflare Workers 上の Hono アプリで、D1 と R2 を使います。設計は
[docs/leaderboard.ja.md](../../docs/leaderboard.ja.md) にあり、この README は動かし方とデプロイ方法を扱います。

## 実装済みのもの

- Better Auth によるログイン: 匿名セッション、passkey、secret が設定されていれば Discord / Google の OAuth。
- `POST /api/v1/scores`: プレイログ（gzip）を送信します。サーバーは対象かどうかの判定と、play / chart fingerprint の
  ドキュメントの確認（検証の層 L1〜L3、`#RANDOM` のない譜面では L4 も）を行い、`lr2`・`beatoraja`・`iidx` で再計算し、
  ログを R2 に保存して自己ベストを更新します。再送された同じプレイはそれと分かり、別のアカウントからの同じプレイは
  拒否します。
- `GET /api/v1/charts/:chartFingerprint/leaderboard` と `.../leaderboard/me`: ランキング。アシスト付きのプレイ、匿名の
  プレイヤー、「このルールセットでプレイしたもの」のフィルタ付き。
- `GET /api/v1/scores/:id` と `.../playlog`。

未実装: 新しい `#RANDOM` の結果に対する L4 と L5、ライバル、ページ、OG カード、プレイヤー側のクライアント。

## 準備

ワークスペースのパッケージは `dist` からバンドルされるので、先にビルドします。

```bash
pnpm run build
```

環境ごとに一度だけリソースを作り、`cf` に求められたら D1 の id を `cloudflare.config.ts` に書きます。

```bash
pnpm exec cf d1 create be-music-leaderboard-staging
```

```bash
pnpm exec cf r2 bucket create be-music-leaderboard-staging
```

環境ごとの secrets（どれもコミットしません）:

| Secret                                       | 用途                                         |
| -------------------------------------------- | -------------------------------------------- |
| `BETTER_AUTH_SECRET`                         | セッションの署名。長いランダムな文字列       |
| `DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET` | Discord でのログイン（任意。未設定なら無効） |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`   | Google でのログイン（任意。未設定なら無効）  |

## データベース

スキーマは `src/db/schema.ts` にあります。変更したらマイグレーションを生成してコミットします。

```bash
pnpm --filter @be-music/leaderboard-api run db:generate
```

マイグレーションはデプロイより先に実行するので、動いている旧コードと両立させます（追加 → 切り替え → 削除）。

```bash
pnpm --filter @be-music/leaderboard-api run db:migrate:staging
```

## デプロイ

Workers Builds が `devel` を staging の Worker に、`main` を本番にデプロイします。

- staging: `pnpm run build && pnpm --filter @be-music/leaderboard-api run db:migrate:staging && pnpm --filter @be-music/leaderboard-api run deploy:staging`
- 本番: 同じ手順を `db:migrate:production` と `deploy` で

この Worker は公開 URL を持ちません。プレイヤーの Worker が `/api/*` と `/leaderboard/*` を Service Binding で
転送します。

## テスト

`pnpm test` で、ワークスペースのほかのテストと一緒にこのパッケージのテストも実行されます。API のテストは Miniflare の
本物の D1 / R2 binding で Hono アプリを動かすので、マイグレーションも確かめます。
