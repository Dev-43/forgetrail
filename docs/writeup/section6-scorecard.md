# Section 6 — Scorecard with Timestamps

One row per judging criterion. **Timestamps are the planned positions from the demo script (INTEGRATION.md section 5) and must be replaced with the real ones after recording.**

| Criterion | Video timestamp | Claim |
|---|---|---|
| Gate | 2:45–2:58 | Loop runs on TrueForge 0.184.2 in local mode; editor tools are MCP tools on `127.0.0.1:3333`; Task B session shown; agent definitions in `agents/`. |
| A1 Inline edit | 0:08–0:24 | Selection + keybinding + instruction gives a native diff per hunk with Accept/Reject buttons. |
| A2 Agent mode | 1:04–2:30 | One panel request makes the agent find and edit 3+ files (`src/flask/cli.py`, `tests/test_cli.py`, `docs/cli.rst`) it was not told about (Task B). |
| A3 Streaming + cancel | 1:16–1:44, 3:38–3:42 | Text and tool calls stream into the panel; Stop cancels immediately (`0 applied, 0 discarded`) and `git status` shows no half-applied hunk. |
| B1 Context assembly | 1:42–1:52 | `suggest_context` / `repo_outline` under a 12,000-token budget (`9,289 / 12,000`); the "Context Chosen" card shows files and token counts before the first hunk. |
| B2 Diff safety | 0:18–0:24, 0:40–0:51 | Each hunk is reviewed in the native diff editor with an inline "why" line; Undo Run restores the file and `git status` / `verify:c` is clean. |
| B3 Resilience | 3:01–3:27 | With the primary key broken (`--break-primary`), the status bar shows the automatic switch to `forgetrail-inline-fallback` and the fallback model's diff appears with no user action; rejecting leaves the workspace unchanged. |
| B4 TrueForge depth | 1:16–1:20, 2:45–2:58 | TrueForge tool approval drives the review; deferred tool loading (`forgetrail-extra` via `list_tools`/`get_tool_info`/`call_tool`) and 8-turn / 30-tool-call trace visible in the session. |
| C1 Video | 0:02, 0:34–0:39, 2:41–2:45, 3:22–3:27 | Tasks A, B, C in order, each verified on screen (`verify:a` + raw `FLASK_DEBUG=off`, `verify:b` + `flask --help`, `verify:c`). |
| C2 Write-up | — | This document. |
