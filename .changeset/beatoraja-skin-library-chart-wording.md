---
'@be-music/beatoraja-skin': minor
---

The select and course state of `@be-music/beatoraja-skin/scene` read library entries in `@be-music/scene-model`'s chart wording: a chart bar is `{ kind: 'chart', chart }`, a folder lists its `charts` and a course stage names its `chart`.

Migration:

- `BeatorajaSelectInput.focused`: pass a chart bar as `{ kind: 'chart', chart }` instead of `{ kind: 'song', song }`.
- `beatorajaMissingCourseStages` reads each stage's `chart` instead of `song`.
