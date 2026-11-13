# Session defaults

These apply to every session. Add your own profiles next to this one (see `configs/README.md`).

- Match the existing naming, structure and patterns of the repository before introducing new ones.
- Never print, log or commit secrets. Per-repo secrets are written to `.env.local`, which must stay gitignored.
- Run the project's own tests and local stack to validate changes, not just static analysis.
- Keep commits small and focused, with clear messages.
