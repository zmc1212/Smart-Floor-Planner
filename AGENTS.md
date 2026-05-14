# Codex Project Instructions

## Git Commit Messages

When Codex is asked to create a git commit in this repository, it must first inspect the recent commit history and match the local convention.

Required workflow:

1. Run `git log -8 --pretty=format:"%s"` before writing the commit message.
2. Infer the style from the recent messages, including language, prefix usage, tense, capitalization, and subject length.
3. Prefer the dominant current style in this repository:
   - English commit subjects.
   - Imperative or concise action phrasing.
   - Use a Conventional Commit prefix such as `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, or `test:` when it fits nearby history.
   - If nearby commits use plain subjects like `Refactor ...`, follow that pattern for similar refactor-only work.
4. Make the subject describe only the changes included in the commit. Do not mention unrelated dirty worktree changes.
5. If the staged changes span multiple unrelated purposes, pause and ask whether to split the commit instead of inventing a broad message.

