# Agent Behavioral Rules

- **Auto-Commit Docs**: Whenever making changes to markdown (`.md`) files or files within the `docs/` directory, automatically stage and commit the changes using `git commit` with an appropriate commit message. Do not ask for permission to commit these files, just do it.
- **Regression Prevention**: **[CRITICAL]** When adding new features or fixing bugs, you MUST ensure that existing functionalities (API contracts, UI layouts, DB schemas, etc.) are strictly preserved. Do not cause side-effects or break existing features. Modify existing code safely and keep the scope of changes minimal.
