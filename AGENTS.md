# Commit Rules

- Write commit messages in English.
- Follow Conventional Commits format: `<type>(optional-scope): <subject>`.
- Use clear and concise subjects in the imperative mood.
- Use `feat:` for new features, `fix:` for bug fixes, `docs:` for documentation-only changes, `refactor:` for non-functional code changes, `perf:` for performance improvements, `test:` for tests, `style:` for formatting-only changes, `ci:` for CI configuration, and `chore:` for maintenance tasks.
- Keep one logical change per commit when possible.
- For documentation-only updates, append `[ci skip]` at the end of the commit message.

# Branch Naming Rules

- Follow the Conventional Branch format (https://conventional-branch.github.io/): `<type>/<description>`.
- Use one of these types:
  - `feature/` (or `feat/`) for new features.
  - `bugfix/` (or `fix/`) for bug fixes.
  - `hotfix/` for urgent fixes.
  - `release/` for release preparation (e.g. `release/v1.2.0`).
  - `chore/` for non-code tasks such as dependency, docs, or tooling updates.
- Write the description in lowercase alphanumerics and hyphens (e.g. `feature/default-skin-redesign`). Dots are allowed only for version numbers in `release/` branches.
- Do not use consecutive, leading, or trailing hyphens or dots, and no spaces or other special characters.
- Include an issue number when one exists (e.g. `fix/issue-123-gauge-flicker`).
- Long-lived branches `main` and `devel` are exempt.

# Pull Request Rules

- Do not prefix pull request titles with `[codex]`.
- Use plain, descriptive pull request titles.

# Changeset Rules

- Base the unreleased set on the diff from the last release: list candidates with `git log --oneline origin/main..origin/devel`. Skip commits already covered by an existing `.changeset/*.md` and only add entries for the uncovered ones.
- One changeset per package. Putting several packages in a single markdown makes Changesets duplicate the same note into every package's CHANGELOG. For a commit that spans multiple packages, split it into one changeset per package and write each note from that package's own perspective.
- Only write entries that are worth landing in a CHANGELOG:
  - Include: `fix` / `feat` / `perf`, and bumps of public (runtime `dependencies`) packages (e.g. `fflate`, `node-web-audio-api`).
  - Exclude: `devDependencies` dependabot bumps (e.g. `typescript`, `vite-plus`, `wrangler`), tooling-only config changes that do not affect consumers (tsconfig paths, build scripts, bench cases), and WIP / in-progress features.
- Bump level: new export / new subpath / new public API → `minor`; bug fix / internal refactor / dependency bump → `patch`.
- Writing style:
  - Keep each body paragraph on a single unwrapped line.
  - Put each list item on its own line.
  - State what changed and why, concisely; lead with the symptom when the change fixes an observable one.
- Releasing: run `pnpm run release:version` on `devel`, commit the generated `packages/*/package.json` and `CHANGELOG.md` together as `chore: version packages`, then merge the `devel -> main` PR to publish. See README "Package Releases".

# Markdown Localization Rules

- Keep English as the canonical `.md` document and Japanese as the `.ja.md` counterpart, except for `AGENTS.md` and `.changeset/README.md`, which remain English only.
- When a Japanese markdown document is translated, move the Japanese source content to the matching `.ja.md` file and keep the translated English content in the original `.md` path.
- Add mutual links at the top of each pair: English files must link to the Japanese file, and Japanese files must link to the English file.
- Keep links within Japanese markdown files pointing to other Japanese markdown files when those counterparts exist.
- Do not add non-changeset Markdown files under `.changeset/` other than `README.md`, because Changesets parses `.md` files in that directory as release entries.

# Documentation Diagram Rules

- Draw diagrams in documentation with Mermaid (` ```mermaid ` fenced blocks). Do not draw ASCII-art or ` ```text ` diagrams; convert an existing one when you edit the section around it.
- Use a diagram wherever it explains something better than prose: data flow and package layering, state machines, the order of events (sequences, timelines), and decision rules. Keep the prose next to it for the details.
- Make the rendered diagram easy to read:
  - Pick the diagram type that matches the content (`flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram`, `timeline`, ...).
  - Choose the direction that keeps it compact (`flowchart TD` for pipelines, `LR` for short chains), and avoid very wide or very tall layouts.
  - Keep node and edge labels short; put explanations in the text, not in the boxes.
  - Group related nodes with `subgraph`, and order nodes so edges do not cross where it can be avoided.
  - Keep one diagram to what fits on one screen; split a large one into several focused diagrams.
  - Do not hard-code colours or a theme, and do not carry meaning by colour alone, so it reads in GitHub's light and dark modes.
- Check that a diagram renders (e.g. in the GitHub preview or the Mermaid Live Editor) before committing it.
- Keep the diagrams of an English `.md` and its Japanese `.ja.md` in sync: the same structure, with labels translated.

# Testing Rules

- Add tests in the same change that introduces new exported functions, new parser directives, new pure-function helpers, or behavior changes to existing ones. Vitest lives at the workspace root (`pnpm test` runs `vp test run`, which executes the projects listed in the root `vite.config.ts`) and individual packages keep `*.test.ts` next to the source under test.
- Tests are mandatory for: parser additions (e.g. new `#SRC_*` directive), pure helpers / utilities, format / op-table mappings (e.g. clear lamp / rank op resolvers), loader path-resolution rules, and any "given input → expected output" function.
- Tests are optional for: Pixi scene classes that bind a WebGL context, demo-side wiring (`packages/player-web-demo/src/main.ts`), and integration glue whose only effect is calling already-tested helpers. When refactoring a previously-untested scene, prefer extracting the logic-heavy parts into pure functions and testing those rather than mocking the renderer.
- When you change a tested helper's behavior, update or add the case that covers the new behavior — never delete an assertion just because it would otherwise fail.

# Benchmark Rules

- When exported functions are added or removed, update benchmarks accordingly (add or delete benchmark cases).

# Layering and File-Size Rules

- `@be-music/chart`, `@be-music/json`, `@be-music/parser` and `@be-music/player`'s `core/`, `playlog/` and `ruleset/` must stay runtime-neutral: no Node built-in imports and no DOM / Node-only globals. Put runtime-specific code behind an adapter (`PlayerOptions.createAudioSession` and friends, `packages/parser/src/node-file.ts`). `pnpm run check` enforces this through the Oxlint overrides in `vite.config.ts`.
- The judge core (`packages/player/src/core/judge-*.ts`, `auto-judge-core.ts`), `ruleset/` and `playlog/simulate.ts` must stay deterministic: take time and randomness as inputs, never read `Date` / `performance`, set timers or call `Math.random`.
- Keep package source files at or under 1,500 lines. `pnpm run check` runs `scripts/lint/file-size-budget.ts` (also `pnpm run check:file-size`): a new file over the budget fails, files already over it are allowlisted there as a TODO and only warn, and a file you bring under the budget must be removed from the allowlist in the same change.
- See `docs/architecture.md` for the engine's judge-core / driver split and the reasons behind these rules.
