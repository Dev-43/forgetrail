# Section 6 — Scorecard with Timestamps

One row per judging criterion. **Timestamps are the planned positions from the demo script (INTEGRATION.md section 5) and must be replaced with the real ones after recording.**

| Criterion | Video timestamp | Claim |
|---|---|---|
| Gate | 2:35 (TODO) | Loop runs on TrueForge 0.184.2 in local mode; editor tools are MCP tools on `127.0.0.1:3333`; Task B session shown; agent definitions in `agents/`. |
| A1 Inline edit | 0:08 (TODO) | Selection + keybinding + instruction gives a native diff per hunk with Accept/Reject buttons. |
| A2 Agent mode | 1:05 (TODO) | One panel request makes the agent find and edit 3+ files it was not told about (Task B). |
| A3 Streaming + cancel | 3:25 (TODO) | Text streams into the panel; Stop cancels immediately and `git status` shows no half-applied hunk. |
| B1 Context assembly | 1:05 (TODO) | `suggest_context` / `repo_outline` under a 12,000-token budget; the "Context chosen" card shows files and reasons before the first hunk. |
| B2 Diff safety | 0:55 (TODO) | Each hunk is reviewed in the diff editor; Undo restores the file and `git status` is clean. |
| B3 Resilience | 2:45 (TODO) | With the primary key broken, the status bar shows the switch and the fallback model's diff appears with no user action; workspace unchanged. |
| B4 TrueForge depth | 2:35 (TODO) | TrueForge tool approval drives the review; deferred tool loading (`forgetrail-extra`) and sub-agents visible in the session. |
| C1 Video | whole video | Tasks A, B, C in order, each verified on screen (`verify:a`, `verify:b`, `verify:c`). |
| C2 Write-up | — | This document. |
