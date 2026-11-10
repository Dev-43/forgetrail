# BUILD.md — ForgeTrail (working name) — Master Spec

> ⚠️ AGENT INSTRUCTIONS: Build ONLY what is listed here. Do not add features, do not infer requirements, do not improve on the spec. If something is unclear, write `// UNCLEAR: [question]` in the code, append the same question to DECISIONS.md under "Open questions", and STOP that task. Do not proceed past unclear points. Read section 0 first.

---

## 0. Rules for every person and every AI agent

| # | Rule |
|---|------|
| R1 | Build only what is listed in your BUILD file. Nothing else. |
| R2 | UNCLEAR rule: see the box above. Never guess. |
| R3 | **Logging rule:** a task is NOT done until (a) its acceptance check passed, (b) one entry was appended to DECISIONS.md "Decision log" in the same commit, and (c) the owner's "Understanding note" for that module in DECISIONS.md was written or updated. No entry, no merge. |
| R4 | **AI agents must log themselves.** Any AI agent that writes code appends to DECISIONS.md "Agent log": who launched it, the one-line instruction it received, which files it changed, any UNCLEAR stop. |
| R5 | No code copied from other projects. Reading other projects for ideas is allowed. If any snippet is copied, declare source URL and licence in DECISIONS.md before merging. Default: zero copied code. |
| R6 | Never commit secrets. Keys live only in `.env` (gitignored). `.env.example` has placeholders only. |
| R7 | One owner per file (see INTEGRATION.md). Do not edit a file you do not own except by the rule in INTEGRATION.md section 3. |
| R8 | All numeric limits live only in `src/shared/limits.ts`. All model-facing message strings live only in the table in section 5 (C6); all user-facing editor strings live only in the table in BUILD_ui.md U-4. Use them exactly. |
| R9 | Everything the editor does must be asynchronous. The extension host must never block (rubric A3). |
| R10 | The extension never calls a model provider. Models are reached only through TrueForge (eligibility gate). |
| R11 | **No provider-specific code or prompts** anywhere in `src/` or in agent instructions. A model name appears only in `config/models.json` and in `manifest.model.name` of the agent JSON files. `npm run check` fails if `src/` mentions a provider name. |
| R12 | **Be tolerant of weak models** (rules in C12). The organisers may choose any model on the shortlist call, and judges score behaviour, not model quality. |

---

## 1. Project Overview

ForgeTrail is a from-scratch VS Code extension that is a thin client of a TrueForge agent. The agent loop, sessions, streaming, approvals, sub-agents and tool plumbing run on TrueForge in local mode. The extension serves editor capabilities (read, search, outline, propose edit, run command) to the agent as MCP tools over a local HTTP server. Every edit is one hunk, held at a TrueForge approval gate, shown in VS Code's native diff editor with the agent's reason, and applied only after the user accepts. Context is chosen by the agent under a budget enforced by the MCP server and shown in the panel. If the primary model fails, the extension reruns on a second configured model automatically.

Goal: maximise Round 1 score (100 points) → top 15. Every build step below is tagged with the rubric criterion it earns.

---

## 2. Scoring map (what earns points, where, who)

| Rubric | Pts | Full-marks anchor | What we build | Shown in video at | Owner |
|---|---|---|---|---|---|
| Gate | pass/fail | Loop on TrueForge; MCP tools; session shown in Task B; agent definition in repo; no direct provider calls | C-2, C-3, agents/*.json | Task B session view | Core (Devesh) |
| A1 Inline edit | 10 | Diff rendered with per-hunk accept and reject | C-6, U-2 | Task A | Core (Devesh) + UI (Vidyankshini) |
| A2 Agent mode | 10 | Discovers and edits ≥3 files unprompted | C-13…C-17 | Task B | Core (Devesh) |
| A3 Streaming + cancel | 10 | Cancel immediate; workspace consistent | C-3, C-19 | Cancel clip | Core (Devesh) |
| B1 Context assembly | 15 | Retrieval with size budget, strategy stated, visibly at work in Task B | C-9…C-12 | Task B context card | Core (Devesh) |
| B2 Diff safety | 10 | Per-hunk review + working undo shown on screen | C-4, U-2, U-4 | Task A + undo | Core (Devesh) + UI (Vidyankshini) |
| B3 Resilience | 10 | Automatic fallback to second model, workspace unchanged | A-5, C-20 | Task C | API (Pranav) + Core (Devesh) |
| B4 TrueForge depth | 10 | MCP tools + approval drives review + one context-engineering feature, visible in session | C-2, C-4, C-14 | Task B session view | Core (Devesh) |
| C1 Video | 10 | All three tasks complete, legible, verified on screen | INTEGRATION.md demo path | whole video | Core (Devesh records) |
| C2 Write-up | 15 | Architecture, context strategy, model setup, trade-offs, accurate scorecard, honest limitations | A-8 + DECISIONS.md | PDF | API (Pranav) + Core (Devesh) |

Rule: where a submission sits between two anchors, the lower applies. Each feature must be clearly shown on screen, not "mostly there".

---

## 3. Milestones and gates

Build order is by dependency. Tasks A, B, C are acceptance tests, not things to build.

| Milestone | Contains | Ends with acceptance test | Target date (IST) |
|---|---|---|---|
| M0 | Contracts frozen (C-1), repo scaffold (C-0), API/UI start in parallel | Contracts reviewed by all three | 10 Nov |
| M1 | MCP server, TrueForge client, propose_edit + apply + undo, minimal modal review, inline edit | **Task A** passes 3 times in a row on clean Flask 3.1.3 | 11 Nov |
| M2 | Budget, outline, suggest_context, mentions, panel, run_command, multi-hunk, agent definition | **Task B** passes 2 of 3 consecutive runs | 12 Nov |
| M3 | Cancel guard, fallback + retries, status bar, break-primary flag | **Task C** (with and without fallback) + cancel clip | 13 Nov |
| M4 | Dry runs, video, write-up, README, checks | Submission checklist (INTEGRATION.md section 8) | 14–15 Nov |

Go/no-go: at the end of each date above, if the milestone is not passed, apply the cut list (INTEGRATION.md section 7) at once. Deadline is 20 Nov 23:59 IST; endsem practicals start 16 Nov, so 14–15 Nov is the real deadline.

---

## 4. Tech stack (exact)

| Item | Choice |
|---|---|
| Language | TypeScript, strict mode |
| Runtime | Node 22.14 or newer (spike ran 22.17.1) |
| Editor | VS Code extension API; engine floor recorded in M0 from the installed VS Code version |
| TrueForge | `@truefoundry/trueforge` **0.184.2**, SDK `@truefoundry/trueforge-sdk` **0.184.1**, both pinned (not `@latest`) |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP transport, version recorded in DECISIONS.md at install |
| Diffing | VS Code native diff editor (`vscode.diff`). No diff library. |
| Search | Pure Node file walk + regex. No ripgrep, no native modules. |
| Outline | Regex-based definition extraction. No tree-sitter. |
| Token estimate | ceil(characters / 4). No tokenizer package. |
| Webview | Plain HTML/CSS/JS. No framework. |
| Tests | `node:test` for pure logic only. Everything else is verified by the acceptance checks. |
| Build/run | `tsc` only; run via F5 (Extension Development Host). No bundler, no Marketplace publishing (out of scope). |
| Script runner | `tsx` (dev dependency) for `scripts/*.ts` |
| Models | Primary `google-gemini/gemini-3-1-flash-lite`. Do NOT use `gemini-3-8-flash` (20 s header timeout in spike). Fallback model decided by A-4. |

No other packages without updating this table first (owner: Core).

---

## 5. Shared contracts (ALL agents must honor these)

### C1 — Ports, URLs, names

| Item | Value |
|---|---|
| TrueForge base | `http://localhost:8790`, API at `/api/v1` |
| MCP server (extension) | `http://127.0.0.1:3333`, fixed port |
| Core connector | name `forgetrail-core`, URL `http://127.0.0.1:3333/mcp-core`, preload true |
| Extras connector | name `forgetrail-extra`, URL `http://127.0.0.1:3333/mcp-extra`, preload false |
| Required env for TrueForge | `OUTBOUND_URL_ALLOWED_HOSTS=["127.0.0.1","localhost"]`, `SQLITE_PATH=<path>` |
| Agent names | `forgetrail-inline-primary`, `forgetrail-inline-fallback`, `forgetrail-agent-primary`, `forgetrail-agent-fallback` |

### C2 — Environment variables (owner: API; documented in `.env.example`)

| Var | Purpose |
|---|---|
| `GEMINI_API_KEY` | Primary provider key |
| `SECONDARY_API_KEY`, `SECONDARY_BASE_URL` | Fallback provider (OpenAI-compatible) |
| `NVIDIA_API_KEY` | Optional, only if A-4 proves it works |
| `FLASK_DIR` | Path to Flask 3.1.3 clone used by verify/reset scripts |
| `TRUEFORGE_URL` | Default `http://localhost:8790` |

### C3 — Model config schema (`config/models.example.json`, owner: API)

| Field | Type | Meaning |
|---|---|---|
| `providers[].name` | string | Provider name registered in TrueForge |
| `providers[].type` | `"builtin"` or `"openai-compatible"` | |
| `providers[].baseUrl` | string, optional | Required for openai-compatible |
| `providers[].apiKeyEnv` | string | Name of the env var holding the key |
| `models.primary` | string | `<provider>/<model>` |
| `models.fallback` | string | `<provider>/<model>` |

### C4 — Limits (`src/shared/limits.ts`, owner: Core only; initial values, tuned in M2 dry runs, every change logged)

| Constant | Value |
|---|---|
| OUTLINE_MAX_TOKENS | 1500 |
| READ_MAX_LINES | 200 |
| SEARCH_MAX_MATCHES | 30 |
| SEARCH_LINE_MAX_CHARS | 200 |
| SUGGEST_MAX_FILES | 8 |
| RUN_RETRIEVAL_MAX_TOKENS | 12000 |
| COMMAND_TIMEOUT_MS | 120000 |
| COMMAND_OUTPUT_MAX_LINES | 200 |
| MAX_ATTEMPTS | 3 |
| AGENT_ITERATION_LIMIT | 40 |
| AUTO_DENY_LIMIT_PER_FILE | 3 |
| BACKOFF_MS | 2000 then 4000 (rate-limit retries only) |

### C5 — MCP tools (owner: Core)

All tool results are plain text. Every retrieval result begins with one header line: `[path | lines a-b of N | ~T tokens | budget left L]`. The model must never copy the header into `old_text`.

| Tool | Connector | Parameters | Behaviour | Approval |
|---|---|---|---|---|
| `read_file` | core | `path`, `start_line?`, `end_line?` | Returns raw text of the range. No range and file longer than READ_MAX_LINES → first READ_MAX_LINES lines plus a truncation note. Counts toward budget. | no |
| `search_workspace` | core | `query` (regex), `path_prefix?`, `case_sensitive?` (default false) | Up to SEARCH_MAX_MATCHES lines `path:line:text`, text cut to SEARCH_LINE_MAX_CHARS. Skips ignored folders. Counts toward budget. | no |
| `propose_edit` | core | `path`, `old_text`, `new_text`, `reason` (≤200 chars), `sources?` (list of paths) | One hunk. If `old_text` is empty and file does not exist → creates the file. Executes only after approval: re-validate, apply, save, snapshot. | **yes** |
| `run_command` | core | `command` | Runs in workspace root with COMMAND_TIMEOUT_MS. Returns `EXIT <code>` + last COMMAND_OUTPUT_MAX_LINES lines. | **yes** (allowlist auto-allows) |
| `repo_outline` | extra | `query`, `path_prefix?` | Definitions (class/def/function) with line numbers, files ranked by keyword score (path match +3, symbol match +2 per keyword), cut at OUTLINE_MAX_TOKENS. | no |
| `suggest_context` | extra | `task` | Up to SUGGEST_MAX_FILES files, each: path, score, reasons (matched keywords/symbols), estimated tokens to read whole file. | no |

Command allowlist (auto-allowed, no prompt): commands starting with `pytest`, `python -m pytest`, `git status`, `git diff`. Everything else shows a modal.

### C6 — Standard messages (use exactly; `<x>` are filled values)

| Code | Exact text | Used by |
|---|---|---|
| E_PATH_OUTSIDE | `ERROR PATH_OUTSIDE_WORKSPACE: <path> is outside the workspace.` | all tools |
| E_PATH_IGNORED | `ERROR PATH_IGNORED: <path> is in an ignored folder.` | read/search/propose |
| E_NOT_FOUND | `ERROR FILE_NOT_FOUND: <path>` | read_file |
| E_BINARY | `ERROR BINARY_FILE: <path>` | read_file |
| E_BUDGET | `ERROR BUDGET_EXHAUSTED: used <u> of <m> tokens. Stop reading. Use what you have or request a narrower range.` | retrieval tools |
| E_FILE_EXISTS | `ERROR FILE_EXISTS: <path>. Use old_text to edit it.` | propose_edit |
| E_TIMEOUT | `ERROR COMMAND_TIMEOUT after <ms> ms.` | run_command |
| E_CANCELLED | `CANCELLED: run was cancelled; nothing applied.` | propose_edit, run_command |
| D_NOT_FOUND | `REJECTED_AUTO: old_text was not found in <path>. Call read_file for the exact lines and retry with exact text.` | auto-deny |
| D_AMBIGUOUS | `REJECTED_AUTO: old_text matched <n> places in <path>. Include more surrounding lines so it matches once.` | auto-deny |
| D_OUTSIDE_REGION | `REJECTED_AUTO: edit is outside the selected region (lines <s>-<e>). Edit only inside it.` | auto-deny (inline mode) |
| D_STALE | `REJECTED_AUTO: <path> changed since you read it. Re-read it and retry.` | auto-deny |
| D_FORMAT | `REJECTED_AUTO: old_text contains line numbers or a header line. Send the raw file text only.` | auto-deny |
| D_USER | `REJECTED_BY_USER: <feedback or no reason given>` | user reject |
| R_APPLIED | `APPLIED <path> lines <s>-<e> (hunk <id>).` | propose_edit |

(TrueForge wraps a denial as "User denied tool call: <reason>" — observed in spike. Our strings travel inside the reason.)

### C7 — Review contract (Core ↔ UI)

`ReviewRequest` (Core → UI)

| Field | Type | Meaning |
|---|---|---|
| id | string | TrueForge tool call id (unique) |
| runId | string | Active run id |
| threadId | string | `main` or a sub-agent thread id |
| path | string | Workspace-relative, forward slashes |
| kind | `"replace"` or `"create"` | |
| oldText | string | Empty for create |
| newText | string | |
| startLine, endLine | number | 1-based range of the matched old text in the current content (create: 1 and line count of new text) |
| reason | string | Agent's one-line why |
| sources | string[] | Files that informed the edit (may be empty) |
| index, total | number | Position within the pending set for this turn |
| baseVersion | number | Document version used to compute the range (staleness check) |

`ReviewDecision` (UI → Core): `id`, `decision` (`"accept"` or `"reject"`), `feedback?` (≤500 chars).

`ReviewPresenter` interface (two implementations: Core's minimal modal in M1, UI's native diff in M1–M2; chosen by one constant in `extension.ts`):
- `present(request) → Promise<ReviewDecision>` — resolves when the user decides; must stay responsive.
- `dispose(runId)` — closes all review tabs and virtual documents for the run; called on cancel and on run end.

### C8 — Agent event contract (Core → UI/panel)

| Event | Fields |
|---|---|
| run.started | runId, kind (`inline`/`agent`), instruction, agentName |
| text.delta | runId, threadId, text |
| tool.started | runId, threadId, toolName, argsSummary |
| tool.finished | runId, toolName, ok, resultSummary |
| context.report | runId, items[{path, reason, tokens}], used, max |
| budget.update | runId, used, max |
| review.requested | ReviewRequest |
| review.resolved | id, decision |
| model.switched | runId, from, to, reason |
| run.cancelled | runId, applied (count), discarded (count) |
| run.finished | runId, summary, applied (count) |
| run.error | runId, kind (`model`/`tool`/`network`/`no-fallback`), message |

### C9 — Run request/result (Core ↔ API's fallback policy)

`RunRequest`: kind, instruction, workspaceRoot, selection (path, startLine, endLine, text; inline only), mentions (resolved text blocks), appliedSoFar (list of hunk summaries; used when a fallback restarts a run).

`executeRun(agentName, request, extraInstruction?) → RunResult` is provided by Core. `RunResult`: status (`done`/`error`/`cancelled`), errorKind, message, appliedCount.

API's `runWithFallback(executeRun, request, config) → RunResult` calls executeRun per the policy in A-5 and emits `model.switched` through a callback.

### C10 — Agent definitions (`agents/*.json`, owner: Core for content, API loads them)

Four files, one per name in C1. Each has: `name`, `description`, `manifest.model.name`, `manifest.instructions`, `manifest.mcp_servers[]`, and runtime `config`. Inline agents: tools limited to `read_file` and `propose_edit`, dynamic sub-agents off. Agent agents: all tools, dynamic sub-agents on, iteration limit = AGENT_ITERATION_LIMIT, compaction and large-tool-response handling on. Exact manifest key names MUST be read from `GET /api/v1/openapi.json` (AgentSpec) — do not guess (V3). Prompts are in BUILD_core.md section "Agent prompts".

### C11 — Run state machine (owner: Core)

States: `idle` → `running` → (`awaiting_review` ↔ `running`) → `finishing` → `idle`; any state → `cancelling` → `idle`. Only ONE run may be active at a time. A new run request while not idle is refused with a status-bar message.

### C12 — Model-independence rules (owner: Core; checked by API's matrix and `npm run check`)

| # | Rule |
|---|------|
| M1 | No provider names, model names or provider-specific behaviour in `src/`; no provider-specific prompt branches. |
| M2 | Prompts and tool schemas are plain and short; no reliance on reasoning/thinking output, thought signatures, parallel tool calls, or JSON modes. |
| M3 | `reason` and `sources` are optional in practice: a missing `reason` is shown as `(no reason given)`, never an error. |
| M4 | `CONTEXT:` and `PLAN:` lines are optional in practice: if absent, the panel falls back to the tool trail (see BUILD_core.md C-18); nothing is invented by the extension. |
| M5 | Paths are normalised before use: a leading `./`, backslashes, and an absolute path inside the workspace become a relative forward-slash path. |
| M6 | `old_text` that looks like numbered or headed output is auto-denied with D_FORMAT (never silently "fixed"). |
| M7 | An inline run that finishes with zero proposals counts as failure kind `no-edit` and goes through the strict retry then fallback. Agent-mode runs with zero proposals are legitimate answers and are not retried. |
| M8 | Minimum model requirement stated in the README: tool calling works, context window at least 32k tokens. |
| M9 | Every model that is claimed to work is listed in `docs/model-matrix.md` with Task A ×3 (and Task B ×2 for two models) pass counts. Untested models are not claimed. |

---

## 6. File structure (root)

```
forgetrail/
├─ README.md                       API
├─ SETUP.md                        API maintains (machine check for every teammate)
├─ LICENSE                         Core (MIT)
├─ DECISIONS.md                    ALL (append-only log; each owner owns their notes)
├─ package.json                    Core
├─ tsconfig.json                   Core
├─ .gitignore  .env.example        API
├─ .vscode/launch.json             Core
├─ config/models.example.json      API
├─ agents/                         Core
│   ├─ inline.primary.json  inline.fallback.json
│   └─ agent.primary.json   agent.fallback.json
├─ docs/
│   ├─ plan/ (BUILD*.md, INTEGRATION.md)
│   ├─ model-matrix.md             API
│   └─ writeup/ (draft sections)   API + Core
├─ demo/app.py  demo/README.md     API
├─ scripts/                        API
│   ├─ start-trueforge.mjs  setup.ts  test-models.ts
│   ├─ verify.ts  reset-flask.ts  check-submission.ts
├─ src/
│   ├─ extension.ts                Core
│   ├─ shared/limits.ts contracts.ts   Core
│   ├─ trueforge/client.ts eventMapper.ts runController.ts   Core
│   ├─ mcp/server.ts runContext.ts budget.ts pathGuard.ts    Core
│   ├─ mcp/tools/ readFile.ts searchWorkspace.ts repoOutline.ts suggestContext.ts proposeEdit.ts runCommand.ts   Core
│   ├─ context/ mentions.ts outline.ts keywords.ts ignore.ts  Core
│   ├─ apply/ applyEdit.ts undoStore.ts                       Core
│   ├─ inline/inlineEdit.ts                                   Core
│   ├─ panel/ agentPanel.ts + webview/{index.html,main.js,style.css}   Core
│   ├─ review/reviewQueue.ts modalPresenter.ts                Core
│   ├─ review/ui/ proposedDocProvider.ts reviewController.ts whyDecoration.ts mockReview.ts   UI
│   ├─ ui/ statusBar.ts notifications.ts                      UI
│   └─ fallback/ classifyError.ts runWithFallback.ts          API
└─ test/ (node:test)               owner of the module under test
```

---

## 7. Unverified assumptions (must be verified, not assumed)

| ID | Assumption | Verified by | Owner | If false |
|---|---|---|---|---|
| V1 | Several `propose_edit` calls in one turn produce several pending approvals, resolvable in one resume turn | C-4 step 6 | Core | Sequence them: instruct the agent to propose one hunk per turn; review queue handles one at a time |
| V2 | Approval gating works on `forgetrail-core` tools while `forgetrail-extra` is deferred | C-14 | Core | Move extras to preload true; drop deferred loading claim, use sub-agents + compaction for B4 |
| V3 | Agent manifest key names for sub-agents / context management | C-14 reading openapi.json | Core | Use Build Agent UI to create, export JSON |
| V4 | Sub-agent approvals carry a `threadId` other than `main` and our pipeline handles it | C-16 | Core | Disallow sub-agents from calling propose_edit via instructions |
| V5 | The 20 s model header timeout is configurable | Ask TrueForge Discord (A-4) | API | Never use thinking models as primary; document in write-up |
| V6 | A second non-Gemini provider works with tool calls through TrueForge | A-4 | API | Use a second Gemini key/model as fallback; state the limitation honestly |
| V7 | Approval response through the SDK uses camelCase `threadId`, `toolCallId` | Spike Test 4 (confirmed) | — | — |

---

## 8. Team overview

| Teammate | Role | Owns | Integrates with |
|---|---|---|---|
| Devesh | Core | M1–M3 engine: MCP server, TrueForge client, retrieval, apply/undo, inline command, panel, agent definitions, cancel guard | UI via ReviewPresenter + AgentEvent; API via executeRun + config + scripts |
| Pranav | API | Setup/registration scripts, config, model matrix, fallback policy, Flask verify/reset/demo app, README, write-up drafts, submission check | Core via executeRun, agents/*.json, C1–C3 |
| Vidyankshini | UI | Native diff review, why decoration, accept/reject commands, status bar, notifications, mock review harness | Core via ReviewRequest/ReviewDecision/ReviewPresenter, run state events |

Per-person files: BUILD_core.md, BUILD_api.md, BUILD_ui.md. Merge rules and demo path: INTEGRATION.md. Decisions, understanding notes and call prep: DECISIONS.md.

---

## 9. DO NOT (applies to all agents)

- Do not add any feature not listed in this document (no model router, no image routing, no autocomplete, no pending-hunks tree, until the cut-list order in INTEGRATION.md allows it and Devesh approves).
- Do not change shared contract definitions (section 5) without Devesh's written approval and a DECISIONS.md entry.
- Do not rename files or folders.
- Do not install packages not listed in section 4.
- Do not use your own judgment to "improve" the code.
- Do not call any model provider from the extension.
- Do not write to the user's files except through the apply path (C-4) after an accept.
- Do not use `@latest` for TrueForge anywhere.
- Do not commit `.env`, `forge.sqlite`, API keys, or tokens.
