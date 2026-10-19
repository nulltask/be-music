[日本語版](./README.ja.md)

# Architecture decisions

Decisions that shape the code and would be costly to reverse, with why they were taken. The target they add up to is in [Architecture](../architecture.md#target-architecture).

- [Skin families only draw](./0001-skin-families-only-draw.md)
- [A runtime-neutral scene-model package](./0002-scene-model-package.md)
- [One play loop with judge strategies](./0003-one-play-loop.md)
- [Course, record and lamp rules live in @be-music/player](./0004-domain-rules-in-player.md)
- [Designed public entry points; breaking changes allowed before 1.0](./0005-public-entry-points.md)
- [The host routes every scene transition through one scene router](./0006-scene-router.md)
- [System sounds share one AudioContext; each play keeps its own](./0007-one-system-audio-context.md)

- [0008: Independent Accounts and OIDC](./0008-accounts-oidc.md)
