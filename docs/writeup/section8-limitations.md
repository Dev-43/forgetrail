# Section 8 — Known Limitations

1. **Free-tier quotas decide Task B.** Task B needs roughly 20–40 model requests. On free tiers the primary runs out of quota or gets 429/503 mid-run; ForgeTrail then backs off and fails over, but a run can still end without finishing. Tool calls are paced at 4.5 s (`MIN_TOOL_INTERVAL_MS` in `src/mcp/server.ts`) to stay under per-minute limits.
2. **20 s model header timeout.** TrueForge 0.184.2 local mode gives a model 20 s to start answering; slower models (observed with `gemini-3-7-flash`) fail and are treated as transient errors.
3. **Model quality still matters for Task B.** In testing, a model produced a `flask config` command that crashed on non-JSON config values (`timedelta`) and still reported "done". ForgeTrail shows every hunk for review but does not itself run the tests before the agent finishes.
4. **Single active run.** One run at a time; the budget and cancel flag belong to the active run because MCP calls carry no TrueForge session id.
5. **Regex outlines only for Python, TypeScript and JavaScript.** Other files are found by `search_workspace` and content scoring in `suggest_context`, but get no symbol outline.
6. **No sandbox on Windows.** TrueForge's local sandbox supports Linux and macOS only; `run_command` runs as a child process in the workspace, auto-allowing only plain `pytest` / `git status` / `git diff` commands and asking for everything else.

### What we would do with another month

- Run the tests (`run_command`) automatically before a run may finish, and feed failures back to the agent.
- Keep the conversation when failing over mid-run instead of restarting on the fallback agent with an "already applied" list.
- Tree-sitter outlines for more languages and an optional embedding index for large repositories.
- A pending-hunks view with accept/reject per hunk across files, and CodeLens actions inside the diff.
- Quota-aware routing that picks a model by remaining quota before the run starts.
