# BUILD_core.md — Core (Devesh): the engine, M1 → M3

> ⚠️ AGENT INSTRUCTIONS: You are building ONLY the items in this file. Nothing else. Build exactly as specified. Read BUILD.md section 0 (rules) and section 5 (contracts) first. If anything is unclear: `// UNCLEAR: [question]`, log it in DECISIONS.md "Open questions", stop that task.

## Your Scope

The engine on the critical path: the MCP server and its tools, the TrueForge client and run controller, retrieval with a budget, the apply/undo path, the inline-edit command, the agent panel, agent definitions, the cancel guard, and integration of the fallback policy. You also own the contracts, `package.json`, and the final video.

Order is strict: M1 → M2 → M3. M1 is the largest block (~11 working hours, rough estimate). API and UI teammates work in parallel from M0 and never block you.

## Your Files

See BUILD.md section 6, every row marked "Core".

## Source of truth from the spike (read before C-2 and C-3)

The raw event samples, approval log, MCP server log and proxy diagnosis from the spike (`05-event-samples.json`, `04-approval.log`, `03-mcp-server.log`, `p4a-proxy-400-response.json`) are ground truth for event shapes. Where this file and those logs disagree, the logs win and the difference is logged in DECISIONS.md.

---

# MILESTONE M0 (10 Nov)

### C-0 Scaffold the repo
- What: TypeScript extension skeleton, `package.json` (name `forgetrail`), `tsconfig.json` (strict), `.vscode/launch.json` (F5 Extension Development Host), `.gitignore` entries (`.env`, `*.sqlite`, `node_modules`, `out`), MIT `LICENSE`, one command `ForgeTrail: Hello`.
- Files: `package.json`, `tsconfig.json`, `.vscode/launch.json`, `LICENSE`, `src/extension.ts`.
- Inputs: BUILD.md section 4 (exact packages, pinned TrueForge versions).
- Outputs: a repo teammates can clone and F5.
- Acceptance: `npm install` and `npm run compile` succeed; F5 opens a host window; the Hello command shows a message. Installed VS Code version recorded in DECISIONS.md.

### C-1 Freeze the contracts in code
- What: `src/shared/limits.ts` with every constant in BUILD.md C4; `src/shared/contracts.ts` with `ReviewRequest`, `ReviewDecision`, `ReviewPresenter`, every event in C8, `RunRequest`, `RunResult`, run states (C11). Field names and meanings exactly as the tables.
- Files: `src/shared/limits.ts`, `src/shared/contracts.ts`.
- Outputs: merged to main FIRST; API and UI start only after this merge.
- Acceptance: compiles; a line-by-line check against BUILD.md section 5 done by Devesh; both teammates reply "contracts read" in the team chat. Entry D-contracts in DECISIONS.md.

---

# MILESTONE M1 — Engine + Task A (target 11 Nov)

### C-2 MCP server (Rubric: Gate, B4)
- What: one HTTP server on 127.0.0.1:3333 (Streamable HTTP) with two endpoints `/mcp-core` and `/mcp-extra`. Each endpoint keeps a map of transports keyed by the `mcp-session-id` header (spike: a single shared transport fails with "Server already initialized"). Port the spike's `read_file` and `search_workspace`, then apply the limits and messages in C4/C6. Add `pathGuard` (every path resolved against the workspace root; anything outside → E_PATH_OUTSIDE; folders `.git`, `node_modules`, `__pycache__`, `.venv`, `venv`, `build`, `dist`, `.tox`, `.pytest_cache` ignored → E_PATH_IGNORED).
- Files: `src/mcp/server.ts`, `src/mcp/pathGuard.ts`, `src/mcp/tools/readFile.ts`, `src/mcp/tools/searchWorkspace.ts`, `src/context/ignore.ts`, `src/mcp/runContext.ts` (singleton holding the active run: runId, cancelled flag, budget used/max, selection region, applied list, pending set).
- Inputs: C1 ports, C4 limits, C5 tool table, C6 messages.
- Outputs: tool results in the C5 format (header line + body).
- Acceptance: start the server from F5; register connectors with API's `npm run setup` (or the spike's scripts until A-3 exists); with TrueForge's own session UI, a chat "read lines 1-50 of src/flask/helpers.py" calls `read_file` and returns exactly 50 lines plus header; a path like `../x` returns E_PATH_OUTSIDE; a search with 100+ matches returns exactly SEARCH_MAX_MATCHES lines. `node:test` unit tests for `pathGuard` and header formatting pass.

### C-3 TrueForge client + run controller (Rubric: Gate, A3, B4)
- What: wrap `@truefoundry/trueforge-sdk`. Functions: create a NEW session for a named agent per run; send a turn (`user.message` input); stream events; map raw events to the C8 events (`eventMapper.ts`); detect `tool.approval_required` and build `ReviewRequest`s from the pending call (id, function name, arguments, thread id); send the next turn with `user.tool_approval` inputs using camelCase `threadId` and `toolCallId` (spike Test 4); cancel via the SDK cancel on the session id; read the final `turn.done` state (`done`, `cancelled`, `error`). Run controller owns the C11 state machine, the single active run, and emits events to listeners (panel, status bar, UI).
- Files: `src/trueforge/client.ts`, `src/trueforge/eventMapper.ts`, `src/trueforge/runController.ts`.
- Inputs: TrueForge at `TRUEFORGE_URL`; agent names (C1); events from spike logs.
- Outputs: C8 events; `executeRun(agentName, request, extraInstruction?) → RunResult` (C9); an exported `subscribe(listener)` from `runController.ts` that delivers every C8 event to listeners and returns a disposable (the UI teammate's status bar, notifications and highlight depend on it; publish a working version in M0).
- Acceptance: with the spike's echo tool, a run streams `text.delta` events as they arrive (first delta within ~2 s); a second `run` request while one is active is refused; the controller returns `error` with the raw `[Model Error] ...` message when the key is invalid (spike: 401 in ~1 s). Unit tests for `eventMapper` using recorded spike samples pass.

### C-4 propose_edit, apply, snapshot, undo (Rubric: A1, B2, B4)
- What, in order:
  1. `propose_edit` tool (core connector). Registered with approval required in the agent definition (C-7/C-14), so it only executes after allow.
  2. **Pre-approval validation** in the run controller (runs when the approval event arrives, before anything is shown): path inside workspace and not ignored (first normalise a leading `./`, backslashes and an absolute path inside the workspace to a relative forward-slash path); `old_text` is not numbered or headed output (every line starting with a line number, or containing the `[path | lines` header, is denied with D_FORMAT); for `replace`, `old_text` occurs exactly once in the CURRENT editor text (use the open document if any, else disk); in inline mode the match lies inside the selected line range; document version equals what the range was computed from. On failure send deny with the matching D_* message from C6 and do NOT show a review. Count auto-denies per file; at AUTO_DENY_LIMIT_PER_FILE stop the run with run.error kind `tool`.
  3. EOL rule: if the document is CRLF, convert `old_text`/`new_text` to CRLF before matching and applying.
  4. **Apply** (after allow, inside the tool): check `RunContext.cancelled` → if set return E_CANCELLED and write nothing; re-validate; apply ONE `WorkspaceEdit` (replace the matched range, or create file) with `workspace.applyEdit`; require result true; then `document.save()`. Open documents not visible are opened silently. Return R_APPLIED.
  5. **Snapshot** before apply: hunk id, run id, path, full text before, full text after. Stored in `undoStore`.
  6. **V1 check:** make the agent emit two `propose_edit` calls in one turn (use a test prompt); record whether TrueForge returns two pending approvals and whether one resume turn carrying two `user.tool_approval` inputs works. Log result in DECISIONS.md. If it fails, switch to the sequential fallback in BUILD.md section 7 V1.
- Undo: `undoLast` reverts the most recent snapshot only if the file's current full text equals the snapshot's "after" text (else report that the file changed and do nothing); `undoRun` reverts every snapshot of the last run in reverse order, stopping at the first mismatch. Commands registered in C-0's manifest as `forgetrail.undoLast` and `forgetrail.undoRun` (UI wires buttons, see BUILD_ui.md U-4). Native Ctrl+Z also works because applying uses WorkspaceEdit.
- Files: `src/mcp/tools/proposeEdit.ts`, `src/apply/applyEdit.ts`, `src/apply/undoStore.ts`, validation in `src/trueforge/runController.ts`.
- Export for the UI teammate: `applyEdit.ts` exports `computeProposedText(currentText, request)`, which returns the file text with the hunk applied (same EOL rule as step 3, same matching as step 2). Publish a working stub in M0 so the UI mock harness can call it; the real one is used by both the review preview and the apply, so the preview always equals what will be written.
- Acceptance (all with Flask 3.1.3): (a) a proposal whose `old_text` does not exist is auto-denied with D_NOT_FOUND and no UI appears; (b) an ambiguous `old_text` is auto-denied with D_AMBIGUOUS; (c) accept → file on disk changed, `git diff` shows exactly the hunk, tool returns R_APPLIED; (d) reject → file bytes identical (check with `git status` clean); (e) `undoLast` restores the file byte-for-byte; (f) editing the file by hand between proposal and accept → D_STALE; (g) V1 result logged.

### C-5 Minimal modal presenter (so the pipeline works before UI delivers)
- What: an implementation of `ReviewPresenter` using one modal warning message per hunk: shows path, reason, line range, and up to 20 lines of old and new text; buttons Accept and Reject; Reject has no feedback box (feedback = empty).
- Files: `src/review/modalPresenter.ts`, `src/review/reviewQueue.ts` (holds pending requests, resolves decisions, calls the presenter one hunk at a time).
- Acceptance: the C-4 acceptance runs end to end through the modal.

### C-6 Inline edit command (Rubric: A1)
- What: command `forgetrail.inlineEdit`. Steps: require a non-empty selection (else a message "Select code first."); ask for an instruction with an input box; build a `RunRequest` of kind `inline` with path, selected line range, selected text; set the selection region in RunContext (enforces D_OUTSIDE_REGION); run through `executeRun` with agent `forgetrail-inline-primary`; show review via the active presenter; on finish show the UI teammate's notification with Undo. Keybinding and menu entries are added by the UI teammate (U-3) in `package.json`.
- Files: `src/inline/inlineEdit.ts`.
- Acceptance: see C-8.

### C-7 Inline agent definitions v1
- What: `agents/inline.primary.json` per C10 and the "Inline agent prompt" below. Tools enabled: `read_file`, `propose_edit` only. Approval required: `propose_edit`. Dynamic sub-agents off.
- Acceptance: API's setup script loads it; a TrueForge session on it can call both tools.

### C-8 M1 acceptance = Task A, three times in a row
Steps (clean state each time via `npm run reset:flask`):
1. `npm run trueforge` and `npm run setup` print all PASS.
2. F5. Open the Flask clone at tag 3.1.3 (commit 22d92470). Open `src/flask/helpers.py`, select the function `get_debug_flag`.
3. Press the inline-edit keybinding; type exactly: `Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.`
4. A review appears within 60 s with at least one hunk and its reason. Accept every hunk.
5. `npm run verify:a` runs `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` and prints `False`.
6. `forgetrail.undoLast` (repeat for each hunk, or `undoRun`) restores the file; `git status` is clean.
Pass = steps 1–6 succeed three consecutive times. Record wall times and any retries in DECISIONS.md. If it fails twice in a row, tighten the inline prompt (log the change) and restart the count.

---

# MILESTONE M2 — Agent mode + context + Task B (target 12 Nov)

### C-9 Budget enforcement (Rubric: B1)
- What: `budget.ts` counts estimated tokens (chars/4) of every retrieval result returned during the run, including injected mentions. Every retrieval result header carries `budget left`. At `used >= RUN_RETRIEVAL_MAX_TOKENS` tools return E_BUDGET. Emit `budget.update` after each retrieval tool call. Resets at run start.
- Acceptance: unit tests for counting; a prompt that asks the agent to read everything gets E_BUDGET before reading more than ~12k estimated tokens.

### C-10 repo_outline (extra connector)
- What: walk workspace (respecting ignore), extract definitions with line numbers by regex: Python `class X`, `def f`, `async def f`; TypeScript/JavaScript `function f`, `class X`, `export const f =`; anything else: skipped. Score files by the `query` keywords (path match +3 per keyword, symbol match +2 per keyword); output highest scoring files first until OUTLINE_MAX_TOKENS.
- Files: `src/context/outline.ts`, `src/context/keywords.ts`, `src/mcp/tools/repoOutline.ts`.
- Acceptance: on Flask 3.1.3 with query `cli command config`, `src/flask/cli.py` ranks first and the result is ≤ OUTLINE_MAX_TOKENS.

### C-11 suggest_context (extra connector)
- What: extract keywords from `task` (split on non-alphanumerics, lowercase, drop stopwords and words under 3 chars, keep identifier-like tokens); score every file by path hits, symbol hits (from outline) and content hit counts; return the top SUGGEST_MAX_FILES with path, score, reasons (which keywords/symbols), and estimated tokens to read the whole file.
- Files: `src/mcp/tools/suggestContext.ts`.
- Acceptance: for the exact Task B instruction, the top 8 include `src/flask/cli.py` and `tests/test_cli.py`, and the CLI documentation page; log the actual list in DECISIONS.md. If one is missing, adjust keyword scoring (log it).

### C-12 @file and @symbol mentions (Rubric: B1)
- Syntax (explicit only): `@file:<workspace-relative path>` and `@symbol:<name>`.
- `@file`: include the file's text up to READ_MAX_LINES; if longer, include the outline of that file plus the first READ_MAX_LINES lines, with a truncation note.
- `@symbol`: find definitions of `<name>` via the outline across the workspace; include up to 3 definitions, each as the definition's body (Python: until indentation returns to the definition's level; other languages: up to 60 lines), with path and line range.
- Resolved blocks are placed in the first message under a heading `ATTACHED CONTEXT` and count toward the budget. Unknown mention → a visible note in the panel and the message "Mention not found: <text>".
- Files: `src/context/mentions.ts`.
- Acceptance: `@symbol:get_debug_flag` in a panel instruction injects the function with `src/flask/helpers.py` and its line range; `@file:src/flask/cli.py` injects the truncated file with outline; both appear in the context card as "mentioned by user".

### C-13 Agent panel (Rubric: A2, A3, B1)
- What: a webview (command `forgetrail.openPanel`) with: instruction box (multi-line), Run button, **Stop button (always enabled while a run is active)**, streaming transcript (`text.delta` appended as received), tool trail (one row per tool call: name, short args, ok/failed), context card (see C-18), budget meter (`used / max` tokens), hunk list (each hunk: path, reason, status pending/accepted/rejected/applied), model badge showing the active model (and "switched" notice), error banner, "Undo run" button. All data comes from C8 events. Messages between webview and extension are plain JSON with a `type` field.
- Files: `src/panel/agentPanel.ts`, `src/panel/webview/index.html`, `main.js`, `style.css`.
- Acceptance: tokens appear incrementally (not all at the end); the editor can be scrolled and typed in while a run is streaming; Stop is clickable at all times during a run.

### C-14 Agent definitions v1 for agent mode (Rubric: B4)
- What: `agents/agent.primary.json` per C10 with the "Agent prompt" below. MCP servers: `forgetrail-core` (preload true; approval required for `propose_edit` and `run_command`) and `forgetrail-extra` (preload false). Dynamic sub-agents on. Iteration limit AGENT_ITERATION_LIMIT. Compaction and large-tool-response handling on. Read key names from `GET /api/v1/openapi.json` first (V3); log them.
- **V2 check:** confirm in the TrueForge session view that (a) the agent reaches `repo_outline`/`suggest_context` through the meta-tools `list_tools`, `get_tool_info`, `call_tool`, and (b) a `propose_edit` call still pauses for approval. Log result. If (a) works but (b) breaks, or vice versa, apply the V2 fallback in BUILD.md section 7.
- Acceptance: both V2 observations logged with a screenshot saved to `docs/evidence/`.

### C-15 run_command (Rubric: A2)
- What: tool `run_command` per C5. Spawn with shell in the workspace root; timeout COMMAND_TIMEOUT_MS; return `EXIT <code>` plus the last COMMAND_OUTPUT_MAX_LINES lines; on timeout kill the whole process tree and return E_TIMEOUT; register the child so cancel can kill it (C-19). Approval handling in the run controller: if the command matches the allowlist in C5, send allow automatically; otherwise show a modal "Run command? <command>" with Run / Deny; Deny sends D_USER.
- Files: `src/mcp/tools/runCommand.ts` (+ allowlist check in `runController.ts`).
- Acceptance: `pytest tests/test_cli.py -q` runs without a prompt and returns the real result; `echo hello` shows the modal; Deny returns a D_USER result to the model; a 3-minute command is killed at the timeout.

### C-16 Multi-hunk, multi-file review flow (Rubric: A2, B2)
- What: when a turn has several pending approvals, the review queue presents them one at a time in order, each hunk showing `index/total`; each decision is collected; when all are decided, ONE resume turn is sent with all `user.tool_approval` inputs (or one per turn if V1 failed). Hunks in the same file are validated against the content at the time they are presented, so earlier accepted hunks in the queue are already applied. **V4 check:** make a sub-agent request a `propose_edit` (test prompt) and record the `threadId` in the pending call; log whether the pipeline handles it; if not, add "never ask a sub-agent to edit" enforcement (already in the prompt) and log.
- Acceptance: a run producing 3+ hunks across 2+ files presents them one by one, applies accepted ones, rejected ones leave bytes unchanged, and the agent receives D_USER reasons for rejected ones.

### C-18 Context report (Rubric: B1 — the "visibly at work" evidence)
- What: parse agent text for lines in the form `CONTEXT: <path> — <reason>` (accept em dash or ` - `); build `context.report` items with path, reason and estimated tokens (from the last read of that path, else file size / 4). If the agent produced no such lines by the time of its first `propose_edit`, build the report from the run's `read_file` calls using the reasons returned by `suggest_context` for that path (matched keywords and symbols); if there is none, use "read by agent". Also parse lines in the form `PLAN: <step>` into a "Plan" card shown above the context card (at most six lines); if the agent writes none, no plan card appears — the extension never invents a plan. The panel shows it as a card titled "Context chosen" with the budget meter. Also surface the sub-agent thread titles (from `thread.created`) next to the files they found.
- Files: `src/trueforge/eventMapper.ts`, `src/panel/*`.
- Acceptance: in Task B the card appears before the first hunk, lists the chosen files with reasons, and the meter shows used/max.

### C-17 M2 acceptance = Task B, 2 of 3 consecutive runs
Steps (clean state each time):
1. Open the agent panel. With NO files mentioned, paste exactly: `Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.`
2. The context card appears listing the files chosen with reasons. Streaming text visible.
3. Review every hunk; accept all. The final diff touches at least three files (`git diff --stat` shows ≥3 files).
4. `npm run verify:b` runs `pytest tests/test_cli.py -q` (must pass) and runs `flask --app demo/app config` (must print JSON with the secret-like keys masked as `***` and normal keys visible) and `flask --help` (must list `config`).
5. The TrueForge session for this run is open at `http://localhost:8790/sessions` showing turns, tool calls, sub-agents and the meta-tool calls.
Pass = steps 1–5 on 2 of 3 consecutive runs. If failing, in this order: tighten the Agent prompt, adjust limits (log each), reduce reading by improving `suggest_context` scoring. Record every change in DECISIONS.md.

---

### C-27 Model tolerance (Rubric: protects A1, A2, B1 under any model; BUILD.md C12)
- What: implement rules M3–M7 of BUILD.md C12: optional `reason` and `sources` with the `(no reason given)` display; optional `CONTEXT:` and `PLAN:` lines with the C-18 fallbacks; path normalisation; D_FORMAT detection; the `no-edit` failure kind for inline runs (RunResult.errorKind), which API's policy retries strictly and then falls back. No provider names anywhere in `src/` (M1).
- Files: `src/trueforge/runController.ts`, `src/mcp/tools/proposeEdit.ts`, `src/trueforge/eventMapper.ts`, `src/shared/contracts.ts` (add the `no-edit` kind with a DECISIONS.md entry).
- Acceptance: `node:test` unit tests for path normalisation, D_FORMAT detection and the missing-reason display pass; a deliberately weak test prompt (model told to omit reasons and CONTEXT lines) still completes Task A and shows the fallback cards; a grep of `src/` for provider names finds nothing.

---

# MILESTONE M3 — Resilience + cancel + Task C (target 13 Nov)

### C-19 Cancel guard (Rubric: A3)
- What: cancel sequence in the run controller (state `cancelling`): (1) set `RunContext.cancelled = true` synchronously; (2) call the SDK cancel on the session; (3) `presenter.dispose(runId)`; (4) resolve all pending reviews as cancelled (nothing sent); (5) kill any running command's process tree; (6) emit `run.cancelled` with applied and discarded counts; (7) return to `idle`. `propose_edit` and `run_command` check the flag before acting (E_CANCELLED). Each apply is atomic, so if a cancel lands during an apply, that single hunk is either fully applied (counted, undoable) or not applied at all. Observed in spike: the cancel call returns in 8–69 ms but a running MCP tool keeps running server-side, which is why these checks are required.
- Files: `src/trueforge/runController.ts`, `src/mcp/runContext.ts`, tools.
- Acceptance: (a) cancel during streaming → stops in <1 s, no file changed; (b) cancel while a review is open → review tab closes, no file changed; (c) cancel immediately after pressing Accept → either the whole hunk is applied or none; `git diff` never shows a partial hunk; (d) a new run works right after (state idle); (e) cancel during `run_command` kills the process.

### C-20 Fallback integration (Rubric: B3)
- What: route every inline and agent run through API's `runWithFallback` (A-5). `executeRun` for attempt 2 appends the STRICT addendum (below) as an extra user message; attempt 3 and any model-failure fallback use the `-fallback` agent in a NEW session. When a fallback restarts an agent run, the first message is the original instruction plus a list `ALREADY APPLIED: <path> lines <s>-<e> — <reason>` so work is not redone. Emit `model.switched`.
- Acceptance: with the primary key invalid (API's `--break-primary`), Task A completes on the fallback agent with no user action; `git status` is clean until the user accepts a hunk.

### C-21 Failure messages (Rubric: B3 floor)
- What: when no fallback is available or all attempts fail, emit `run.error` kind `no-fallback` with a clear one-line message; panel and UI show it; no stack trace is ever shown to the user; workspace unchanged; editor stays responsive. Messages shown to the user are the strings in the BUILD_ui.md U-4 table.
- Acceptance: with BOTH models broken, Task A shows the message within 10 s (model failures return in ~1–4 s in spike), editor remains editable, `git status` clean.

### C-24 Fallback agent definitions
- What: `agents/inline.fallback.json` and `agents/agent.fallback.json` identical to the primary ones except `manifest.model.name` (set from API's A-4 recommendation).

### C-22 M3 acceptance = Task C
1. `npm run setup -- --break-primary` (primary provider gets an invalid key). Repeat Task A exactly as in C-8.
2. Case 1 (fallback configured): the status bar shows the model switch; a diff from the fallback model appears with no user action; the editor stays responsive; reject the diff; `git status` shows no files changed.
3. Case 2 (`--no-fallback`): a clear message appears; editor responsive; `git status` clean.
4. `npm run setup -- --restore` restores the primary.
Pass = both cases succeed twice.

### C-23 Cancel clip acceptance
Start an agent-mode run, press Stop while text is streaming; the panel shows "Cancelled — N applied, M discarded"; `git status` shows only the hunks accepted before the stop; a new run starts immediately. Rehearse until it takes under 20 seconds on screen.

---

# MILESTONE M4 (14–15 Nov) — Core part

### C-25 Record the video
Follow INTEGRATION.md section 5 exactly. Record on the final tagged build. Keep TrueForge session view ready on a second tab.

### C-26 Write-up sections
Draft sections 3 (Architecture on TrueForge), 4 (How context is selected), 6 (Scorecard with timestamps), 8 (Known limitations) in `docs/writeup/`. Every claim must be backed by an entry in DECISIONS.md or a logged evidence file. The limitations must include at least: second provider status, pre-1.0 TrueForge pinned version, single active run, regex outline limited to Python/JS/TS, 20 s model timeout, Windows sandbox unavailable.

---

## Stretch (only after the M3 gate passes and Devesh approves) — S-1 Verifier sub-agent

- Why it is a stretch: the TrueForge manifest documents only dynamically spawned sub-agents (the parent agent chooses each sub-agent's name and input); there is no fixed roster. Roles can only be steered by the prompt, and a sub-agent that runs `pytest` must pass through the same approval path (check V4 first). Orchestration beyond the Scout earns no extra rubric points; B4 is already satisfied by the Scout plus deferred loading.
- What: add to the Agent prompt one rule — after the edits are accepted, delegate "run the relevant tests and report the result" to a sub-agent named `verifier`, which may only use `run_command` and `read_file`. Keep editing in the main agent so every hunk has a single author.
- Acceptance: 3 of 3 consecutive Task B dry runs spawn the verifier, the test command auto-runs through the allowlist, and the session view shows the sub-agent. If any run fails, remove the rule and log it in DECISIONS.md; the main agent keeps running the tests itself.

---

## Agent prompts (exact text; copy into the `instructions` field)

### Inline agent prompt
```
You are ForgeTrail's inline editor inside VS Code. You edit ONE selected region of one file. The user message tells you the file path, the selected line range and the selected text. You can act only through your tools.
1. If you need context, call read_file on the path for the selected lines plus up to 20 lines on each side.
2. Change code only with propose_edit. Every old_text must lie entirely inside the selected lines. Make one hunk per logical change (for example, a code change and a docstring change are two separate hunks).
3. Copy old_text exactly from read_file output. Never include the header line or line numbers. Include one or two unchanged neighbouring lines so old_text matches exactly once.
4. Give every hunk a one-sentence reason (maximum 200 characters).
5. If a hunk is rejected, read the reason, change your approach, and never resend the same hunk.
6. When finished, reply with one line saying what changed.
```

### Agent prompt (agent mode)
```
You are ForgeTrail, a coding agent inside VS Code working in the user's open workspace. You can act only through your tools.
1. Never guess file names. If the user did not name the files, call suggest_context with the task first, then read only the ranges you need with read_file. Use search_workspace for exact names. Use repo_outline when you need the structure of a file or folder.
2. Before your first edit, write one line per file you decided to use, exactly in this form: CONTEXT: <path> — <why this file matters>. Then write your plan as at most six lines, each in this form: PLAN: <step>. Then continue.
3. Respect the budget. Every retrieval result shows "budget left". If you receive BUDGET_EXHAUSTED, stop reading and act on what you have.
4. Change code only with propose_edit. One hunk per call. Copy old_text exactly from read_file output (never the header line or line numbers). Include two or three unchanged neighbouring lines so old_text matches exactly once. Give a one-sentence reason (maximum 200 characters) and list the files that informed the edit in sources.
5. Keep edits minimal. Do not change code the user did not ask you to change.
6. If a call is rejected, read the reason, change your approach, and never resend the same hunk.
7. If the task mentions tests, add or update tests with propose_edit, then run them with run_command and fix failures. If the task mentions documentation, update the existing documentation page that describes similar features.
8. Use sub-agents only for read-only search work such as finding where something is defined or used. Never ask a sub-agent to edit files.
9. When finished, reply with at most five lines: what changed and in which files.
```

### STRICT addendum (attempt 2; sent as an extra user message)
```
STRICT MODE. Your previous attempt failed: <failure summary>. Now: call read_file on the exact lines first; copy old_text character for character from that output; use at most 8 lines of old_text; one hunk per call; do nothing else.
```
Failure summary values: `proposals did not match the file`, `the model returned an error`, `edits were outside the selected region`.

---

## Contracts You Must Honor

BUILD.md section 5: C1–C11 in full. You are the only person allowed to change them (with a DECISIONS.md entry).

## DO NOT

- Do not build anything outside your scope list (no model router, no image routing, no PageRank, no tree-sitter, no embeddings, no autocomplete, no pending-hunks tree).
- Do not modify files owned by other teammates (UI: `src/review/ui/*`, `src/ui/*`; API: `scripts/*`, `config/*`, `src/fallback/*`, `README.md`, `demo/*`).
- Do not change the shared contract definitions without a DECISIONS.md entry and notice to both teammates.
- Do not add packages without updating BUILD.md section 4 first.
- Do not let any code path write to the user's workspace except the apply path in C-4.
- Do not use `@latest` for TrueForge.
