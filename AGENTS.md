# Commit Rules

- Write commit messages in English.
- Follow Conventional Commits format: `<type>(optional-scope): <subject>`.
- Use clear and concise subjects in the imperative mood.
- Use `feat:` for new features, `fix:` for bug fixes, `docs:` for documentation-only changes, `refactor:` for non-functional code changes, `test:` for tests, and `chore:` for maintenance tasks.
- Keep one logical change per commit when possible.
- For documentation-only updates, append `[ci skip]` at the end of the commit message.

# Pull Request Rules

- Do not prefix pull request titles with `[codex]`.
- Use plain, descriptive pull request titles.

# Markdown Localization Rules

- Keep English as the canonical `.md` document and Japanese as the `.ja.md` counterpart, except for `AGENTS.md` and `.changeset/README.md`, which remain English only.
- When a Japanese markdown document is translated, move the Japanese source content to the matching `.ja.md` file and keep the translated English content in the original `.md` path.
- Add mutual links at the top of each pair: English files must link to the Japanese file, and Japanese files must link to the English file.
- Keep links within Japanese markdown files pointing to other Japanese markdown files when those counterparts exist.
- Do not add non-changeset Markdown files under `.changeset/` other than `README.md`, because Changesets parses `.md` files in that directory as release entries.

# Benchmark Rules

- When exported functions are added or removed, update benchmarks accordingly (add or delete benchmark cases).
