---
'@be-music/skin-sdk': minor
---

Expose shared scene-model library entries, play options, play/results and course data to custom skins.

- Support course bars and records, keyboard-wheel lanes, 24/48-key filters, additional sort modes, touch-scroll rows and in-place search state.
- Provide chart facts from the resolved chart, shared clear-lamp/rank vocabulary and result presentation for single plays, course stages and complete runs.
- Add deterministic hold-spark effects.
- Validate required font-load declarations and report missing skin metadata instead of failing during loading.

Migration: use chart entries (`entry.chart`, `folder.charts`) and the shared library types from `@be-music/scene-model`. Use canonical abbreviation spellings and shared result/record types. The developing skin API revision is `0`; existing revision-1 declarations remain accepted.
