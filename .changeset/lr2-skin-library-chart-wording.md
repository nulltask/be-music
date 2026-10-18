---
'@be-music/lr2-skin': minor
---

`resolveLr2SelectState` reads the bar under the cursor in `@be-music/scene-model`'s chart wording: a chart bar is `{ kind: 'chart', chart }`, a folder lists its `charts` and a course stage names its `chart`. LR2's own `song` bar body (`Lr2BarBodyKind`) is unchanged.

Migration:

- `Lr2SelectInput.focused`: pass a chart bar as `{ kind: 'chart', chart }` instead of `{ kind: 'song', song }`.
