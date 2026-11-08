[English version](./README.md)

# @be-music/worker-play

Cloudflare Workers で動くプレイヤー配信用の Worker です。build した player（[`@be-music/app-play`](../app-play/README.ja.md)）を Static Assets で配信し、OIDC セッション、プレイヤーの設定、Leaderboard の API への転送、URL・メディアのプロキシを扱います。ffmpeg core を R2 から返す処理も受け持ちます。

[サービスと環境](../../docs/services.ja.md) を参照してください。

## デプロイ

`main` と `devel` に push すると、すべてのサービスが本番とプレビューにデプロイされます（`.github/workflows/deploy.yml`）。Player を手でデプロイするには次を実行します。

```bash
pnpm --filter @be-music/app-play run cf:r2:push # 固定している @ffmpeg/core が変わったとき: core を R2 へ upload
pnpm --filter @be-music/worker-play run deploy                # 本番、play.be-music.app
pnpm --filter @be-music/worker-play run deploy:preview        # プレビュー、play.preview.be-music.app
```

`deploy` は player を build して `cf deploy` を実行します。ffmpeg core（`ffmpeg-core.wasm` / `ffmpeg-core.js`）は Static Assets の 1 file あたりの上限を超えるので、R2 に置いて Worker 経由で配信します。
