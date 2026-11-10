# DECISIONS.md — Decisions, understanding notes and call prep

Purpose: so nobody has to re-read the whole codebase to explain it. This file is what each of us reads before the 10-minute shortlist call (code walkthrough + Task A live with the organisers' model). A team member who cannot explain the submission gets replaced by the next team, so this file is part of the product.

## Part 1 — The rules (apply to people AND AI agents)

### 1.1 Decision Logging Rules
1. **A task is not done until it is logged.** Same commit as the code: one entry in Part 2, and the owner's note in Part 3 written or updated. No entry, no merge.
2. **Append-only log.** Never rewrite an old decision. If a decision changes, add a new entry that says `Supersedes D-xxx` and why.
3. **What deserves an entry:** any choice between alternatives, any limit or constant changed, any contract change, any workaround, any verification result (V1–V7), any change made to prompts, any copied snippet (source + licence).
4. **AI agents log themselves** in Part 5 (who launched it, instruction in one line, files changed, UNCLEAR stops). Human launching the agent is responsible for its entry.
5. **Understanding notes are written in your own words** after the module works, max 120 words each, answering: what it does, how it works, why this design, what breaks, how to demo it.
6. **Rehearse.** Everyone reads Part 3 for their own modules and Part 4 before the call; the Q&A bank in Part 6 must be rewritten in your own words once the build is done.

### 1.2 Git & Commit Rules (Mandatory across all teammates)
1. **Granular commits only:** Every commit must represent a single, atomic, well-defined change (e.g. one task step, contract definition, single feature, or verification test). NEVER batch multiple unrelated tasks into huge 2-3 commit bulk dumps.
2. **Commit message format:** `<task id>: <what>` (e.g., `C-0: repo scaffold`, `C-1: freeze contracts in code`, `A-1: config and env templates`, `U-2: proposed doc provider`).
3. **Dual requirement for task commits:** Every commit completing a task MUST include both:
   - The implementation/test files for that task.
   - The corresponding entry in `DECISIONS.md` Part 2 ("Decision log") and/or Part 3 ("Understanding notes").
4. **Branching strategy:**
   - `main`: Protected, production-ready, always working. Devesh alone merges to `main` following acceptance verification.
   - `core/<topic>`: Devesh's feature branches.
   - `api/<topic>`: Pranav's feature branches.
   - `ui/<topic>`: Vidyankshini's feature branches.
5. **No secret commits:** Never commit `.env`, API keys, tokens, or SQLite databases (`.gitignore` must be strictly respected).
6. **Package.json ownership:** `package.json` is owned by Devesh (Core). Pranav (API) and Vidyankshini (UI) submit their additions in small separate commits/PRs; Devesh resolves conflicts.

Entry format (copy this):

| Field | Content |
|---|---|
| ID | D-0xx |
| Date / time (IST) | |
| Author | person, or agent name + who launched it |
| Task / module | e.g. C-4 |
| Decision | one sentence |
| Why | evidence (spike file, test result, doc) |
| Alternatives rejected | |
| Rubric impact | criterion and points |
| Call line | one sentence you could say out loud on the call |

---

## Part 2 — Decision log

### D-001 Build the editor side from scratch (no fork)
- Date 2026-11-10 · Author Devesh with Claude (planning assistant) · Task: architecture
- Decision: no upstream fork; VS Code native APIs for review UI.
- Why: easier to explain on the call; no fork-commit or licence risk; the brief says rebuilding a diff viewer is not a demonstration of skill, so we use the native diff editor instead of building one.
- Alternatives rejected: forking Cline/Continue/Roo/opencode (must replace their agent loop, declare commit, keep licence).
- Rubric: C2 (honest starting point), eligibility.
- Call line: "We wrote the editor side ourselves on VS Code's native diff editor, and the agent loop is entirely TrueForge."

### D-002 The extension is a thin TrueForge client; editor capabilities are MCP tools over local HTTP
- Why: eligibility gate (agent decides, extension serves tools); spike showed TrueForge's MCP connector supports HTTP/SSE only, not stdio, and works against localhost once `OUTBOUND_URL_ALLOWED_HOSTS` allows loopback.
- Rubric: Gate, B4.

### D-003 Allow loopback through the documented environment variable, do not weaken network policy otherwise
- Why: spike Test 3 — registration blocked loopback until `OUTBOUND_URL_ALLOWED_HOSTS` was set; the variable name was found in the source, not the docs, so it is written in the README.

### D-004 MCP server keeps a session map keyed by `mcp-session-id`
- Why: spike — one shared transport fails with "Server already initialized" when TrueForge opens several sessions.

### D-005 `propose_edit` is one hunk per call and is held at TrueForge's approval gate
- Why: spike Test 4 — pause/resume works, the pending call's arguments arrive intact, but allow cannot modify arguments; therefore partial acceptance of a multi-hunk call is impossible. One hunk per call makes each approval a per-hunk decision. User feedback travels in the deny reason (590-character test passed).
- Rubric: A1, B2, B4.
- Call line: "Each hunk is its own tool call, so TrueForge's approval is literally our per-hunk accept and reject."

### D-006 Nothing touches a buffer or disk until Accept; apply is one atomic WorkspaceEdit followed by save
- Why: makes cancel safe by construction; the save is needed because Task A's check runs Python against disk; WorkspaceEdit puts the change on VS Code's undo stack.
- Rubric: A3, B2.

### D-007 Fallback is client-side (rerun on a second configured agent), not a model proxy
- Supersedes: the early proxy idea.
- Why: spike P4a — a proxy in front of Gemini 3 fails on tool-calling histories (`thought_signature` required), while plain chat works; client-side fallback worked end to end (failure detected in ~4 s, then the second agent completed Task A-like work).
- Alternatives rejected: local OpenAI-compatible proxy router.
- Rubric: B3 (10).
- Call line: "TrueForge has no built-in model fallback, so the extension detects the failed turn and replays it on a second agent."

### D-008 Retrieval is lexical + regex outline with a budget enforced by the MCP server
- Why: tree-sitter needs native builds (Windows risk); embeddings need extra providers/limits and are out of scope; PageRank is polish. Budgeted outline + keyword ranking is enough for Flask (~17k lines) and every tool result states the remaining budget, which makes it visible and model-independent.
- Starting numbers: outline 1500 tokens, 200 lines per read, 30 search matches, 12000 tokens retrieved per run (to be tuned in M2 dry runs and logged).
- Rubric: B1 (15).

### D-009 Deferred tool loading applies to the extras connector only
- Why: the combination "deferred loading + approval gating" was not tested in the spike; keeping `propose_edit`/`run_command` on a preloaded connector isolates that risk while still giving visible deferred-loading use (outline and suggest_context).
- Rubric: B4 (10). Verification: V2.

### D-010 Skills and Code Mode are not used
- Why: docs say they need a sandbox; the local sandbox provider is unsupported on Windows (spike); the sandbox is optional in the brief.

### D-011 Pin TrueForge 0.184.2 and SDK 0.184.1
- Why: pre-1.0 release candidate; `@latest` could change behaviour before the deadline.

### D-012 Primary model is `gemini-3-1-flash-lite`; `gemini-3-8-flash` is avoided
- Why: spike Test 2 — `gemini-3-8-flash` hit a 20 s header timeout; flash-lite returned in ~1–5 s. Risk noted for the shortlist call (organisers may pick a slow thinking model).

### D-013 Roles simplified: one main agent plus dynamic Scout sub-agents
- Supersedes: the early pitch of four agents (Scout, Planner, Editor, Verifier).
- Why: TrueForge sub-agents are created by the model, so distinct fixed roles cannot be guaranteed; the prompt asks for read-only search sub-agents, planning and editing stay in the main agent, and verification is `run_command`.
- Call line: "The orchestration is real TrueForge sub-agents for search; we kept editing in one agent so every hunk has a single author."

### D-014 Escalating retries: normal, then strict prompt, then fallback model (max 3 attempts)
- Why: Devesh's idea; mechanical failures (non-matching proposals) are fixed by tighter instructions, model failures by switching model. Rate-limit and transient errors use backoff first (2 s then 4 s).
- Rubric: B3.

### D-015 One active run at a time
- Why: TrueForge allows one turn per session; the budget and the cancel flag belong to the active run, because MCP calls carry no TrueForge session id.

### D-016 Team split by risk and hours
- Core (Devesh): critical path M1–M3. API (Pranav): scripts, fallback policy, verification, docs (pure logic, parallel). UI (Vidyankshini): native review (20 rubric points) built against a mock first.
- Fallback: Core's modal presenter if UI is late (accepted by Devesh).

### D-017 Dropped: image routing and the model-router module
- Why: tasks are text-only; images break the "any model" fairness rule; a router adds failure points and the client-side fallback covers the scored behaviour.

### D-018 Review preview uses VS Code's native diff editor with a virtual "proposed" document
- Why: no custom diff viewer needed; removed lines visible; stock VS Code cannot draw removed lines inline in a normal editor. CodeLens is optional later.

### D-019 Schedule and cut list
- Build 10–13 Nov, video and write-up 14–15 Nov, hard deadline 20 Nov 23:59 IST; endsem practicals from 16 Nov. Cut-list order in INTEGRATION.md section 7.

### D-020 `run_command` allowlist (`pytest`, `python -m pytest`, `git status`, `git diff`) auto-allowed; everything else asks
- Why: keeps Task B smooth while keeping a human in the loop for anything else.

### D-021 Spike facts (verified 2026-11-09/10, Windows 11, Node 22.17.1)
- Cancel returns in 8–69 ms; a running MCP tool keeps running after cancel (hence the guard, C-19).
- Failure messages: unreachable → `[Model Error] Cannot connect to API`; invalid key → `[Model Error] Request failed (401)`, both in about 1–4 s.
- NVIDIA key returned 404 `Function not found for account` on every model; A-4 retests from teammates' accounts.

### D-022 Orchestration realised as visible steps, with sub-agents steered by the prompt
- Date 2026-11-10 · Author Devesh with Claude · Task: architecture · Partly supersedes D-013
- Decision: Scout = dynamic read-only sub-agent; Plan = `PLAN:` lines shown as a card; Editor = main agent (one author per hunk); Verifier = `run_command` by the main agent, with a Verifier sub-agent only as stretch S-1 after it passes 3 of 3 dry runs.
- Why: checked 2026-11-10 against TrueFoundry's docs — the agent manifest documents only dynamically spawned sub-agents (`dynamic_sub_agents`), and the parent decides each sub-agent's name and input; there is no fixed roster. So roles can be steered by prompt but not guaranteed. Orchestration beyond the Scout earns no extra rubric points (B4 needs one context-engineering feature).
- Alternatives rejected: four mandatory sub-agent roles (unreliable, more failure points, approvals from sub-agents are untested — V4).
- Call line: "TrueForge only spawns sub-agents dynamically, so we steer a read-only scout with the prompt and keep editing in one agent."

### D-023 Model independence is enforced by rules and tests, not by intent
- Decision: BUILD.md R11/R12 and C12 (M1–M9): no provider names or provider-specific prompts in `src/`, tolerance for weak models, a model matrix with Task A ×3 on at least 3 models, a check script that greps for provider names, and a README minimum (tool calling, 32k context).
- Why: the organisers may choose any model on the shortlist call and judges score behaviour, not model quality.
- Rubric: protects A1, A2, B1, B3 and the shortlist call.

### D-024 Context card falls back to `suggest_context` reasons
- Why: B1's top anchor needs the agent to show which files it chose and why; if a model skips the `CONTEXT:` lines, the card still shows the reasons the retrieval tool returned (matched keywords and symbols) instead of a bare list.

### D-025 Transparency set
- Decision: context card with budget meter, plan card, per-hunk why plus sources, tool trail in the panel, and the TrueForge session view. Model reasoning streams are not relied on because they are model-dependent.
- Why: these are visible in the three tasks, model-agnostic, and map to B1, B2 and B4.

### D-026 Setup, team roles and git commit conventions finalized
- Date 2026-11-10 · Author Devesh with Antigravity assistant · Task: M0 setup
- Decision: Formalized team assignments (Devesh = Core, Pranav = API, Vidyankshini = UI), enforced strict granular commit rules (`<task id>: <what>`), isolated `dev/` local spike folder into `.gitignore`, and initialized git repository for team collaboration.
- Why: Clear ownership prevents merge collisions; granular commits guarantee auditability and rubric scoring (C2 write-up).
- Rubric: C2 (honest audit trail), Eligibility.

### D-027 Task C-0: Extension scaffold, pinned TrueForge, and build baseline
- Date 2026-11-10 · Author Devesh with Antigravity assistant · Task: C-0
- Decision: Scaffolding created with package.json (`forgetrail`), tsconfig strict mode, VS Code launch/tasks configurations for Extension Development Host, `src/extension.ts` hello command, and pinned TrueForge dependencies: `@truefoundry/trueforge@0.184.2`, `@truefoundry/trueforge-sdk@0.184.1`, `@modelcontextprotocol/sdk@1.6.0`. Local VS Code version recorded: 1.144.1. TrueForge installed locally into `node_modules` and executable via `npm run trueforge`.
- Rubric: C-0 acceptance, Eligibility.

### D-028 Task A-1: Environment and model configuration templates
- Date 2026-11-10 · Author Pranav (API) with Antigravity assistant · Task: A-1
- Decision: Created `.env.example` documenting all C2 environment variables and `config/models.example.json` documenting the C3 schema for primary (`google-gemini/gemini-3-1-flash-lite`) and OpenAI-compatible fallback, with zero real API keys committed.
- Rubric: A-1 acceptance, R6 (no secrets).

### D-029 Task C-1: Freeze contracts in code and M0 stubs
- Date 2026-11-10 · Author Core (Devesh) & UI (Vidyankshini) with Antigravity assistant · Task: C-1
- Decision: Froze all limits in `src/shared/limits.ts` (C4) and shared review/event/run contracts in `src/shared/contracts.ts` (C6, C7, C8, C9, C11). Added initial M0 stubs in `src/apply/applyEdit.ts` (`computeProposedText`) and `src/trueforge/runController.ts` (`subscribe`).
- Why: Integration dependency I-1 and I-2; UI and API feature builds require frozen contracts to compile and mock against.
- Rubric: Gate, Eligibility.

### D-030 Task U-1 & U-2: Native diff review architecture with proposedDocProvider and whyDecorations
- Date 2026-11-10 · Author Vidyankshini (UI) with Antigravity assistant · Task: U-1, U-2
- Decision: Implemented native diff review using `vscode.diff` between original file (or empty virtual doc for file creation) and `forgetrail-proposed://` virtual documents rendered via `ProposedDocProvider`. Inlined agent reason and sources via non-intrusive italic description decorations (`whyDecoration.ts`) using theme-adaptive colors. Enforced document version matching to detect staleness before accepting. Included standalone mock harness (`mockReview.ts`) presenting three sequential ReviewRequests for end-to-end testing without external backend dependencies.
- Why: Satisfies rubric A1 (10 pts) and B2 (10 pts) by providing a clean, per-hunk diff review interface using VS Code native diff editors.
- Alternatives rejected: Custom webview diff viewer (high maintenance, poor keyboard shortcuts, rubric explicitly favors native diffs).
- Rubric: A1 (10), B2 (10).
- Call line: "We render each proposed hunk inside VS Code's native diff editor with the agent's explanation shown directly on the right side."

### D-031 Task U-3 & U-4: Status bar manager, notifications with undo actions, inline-edit entry points, and selection highlighting
- Date 2026-11-10 · Author Vidyankshini (UI) with Antigravity assistant · Task: U-3, U-4, U-5
- Decision: Added `StatusBarManager` listening to C8 agent events to show active model, running state, pending review counters, and model switch notices. Created notification helpers with direct "Undo last" and "Undo run" command triggers. Configured editor context menu and keybinding `ctrl+alt+e` (`cmd+alt+e`) for `forgetrail.inlineEdit`, plus keybindings `ctrl+alt+y` and `ctrl+alt+n` for diff accept/reject. Implemented `registerSelectionHighlight` to visually highlight user selection during active inline runs.
- Why: Provides clear user transparency on agent status and safety recovery (undo) per rubric B2 and A1.
- Rubric: A1 (10), B2 (10).
- Call line: "The status bar and notifications keep the user aware of every run state, with one-click undo directly accessible from the notification."

### D-032 Task C-2: MCP server with Streamable HTTP multi-session transport and pathGuard
- Date 2026-11-10 · Author Devesh (Core) with Antigravity assistant · Task: C-2
- Decision: Implemented local HTTP MCP server on `127.0.0.1:3333` serving `/mcp-core` and `/mcp-extra`. Managed session transports via `mcp-session-id` header map to handle multi-turn agent handshakes without "Server already initialized" errors. Pinned `@modelcontextprotocol/sdk` at version `1.32.2` (Streamable HTTP support). Implemented `pathGuard` (normalizing leading `./` and backslashes, blocking paths outside workspace root with `E_PATH_OUTSIDE`, and blocking ignored folders `.git`, `node_modules`, `__pycache__`, `.venv`, `build`, etc. with `E_PATH_IGNORED`). Implemented `read_file` (with `READ_MAX_LINES` truncation and binary detection) and `search_workspace` (regex search with `SEARCH_MAX_MATCHES` and `SEARCH_LINE_MAX_CHARS` limits), both returning canonical bracketed header lines and reporting token budget usage against `RUN_RETRIEVAL_MAX_TOKENS`. Verified via `test/mcp.test.ts`.
- Why: Gate and B4 rubric requirement; TrueForge connects to editor tools via MCP over local Streamable HTTP.
- Rubric: Gate, B4 (10).
- Call line: "The extension runs a local MCP server on port 3333 that enforces path confinement and token budgets before returning any file contents to TrueForge."

(Add D-033 onward below. Template above.)

---

## Part 3 — Understanding notes (one per module; owner writes after it works)

Status values: `TO FILL` → `DRAFT` → `CHECKED` (a teammate read it and could explain it back).

| Module | Owner | Status | Note (max 120 words: what / how / why / what breaks / how to demo) |
|---|---|---|---|
| MCP server and path guard | Devesh (Core) | CHECKED | Runs on `127.0.0.1:3333` via `@modelcontextprotocol/sdk` Streamable HTTP with endpoints `/mcp-core` and `/mcp-extra`. Resolves TrueForge's multi-turn transport collisions by maintaining a session map keyed on `mcp-session-id`. `pathGuard` normalizes paths and blocks anything outside workspace (`E_PATH_OUTSIDE`) or in ignored directories (`E_PATH_IGNORED`). `read_file` and `search_workspace` enforce line and match limits and prepend `[path | lines | ~tokens | budget left]` headers, deducting from the 12k token budget in `runContext`. Demo by calling `/health` or inspecting tool responses. |
| TrueForge client and run controller | Devesh (Core) | TO FILL | |
| propose_edit, apply, snapshot, undo | Devesh (Core) | TO FILL | |
| Retrieval: budget, outline, suggest_context | Devesh (Core) | TO FILL | |
| @file and @symbol mentions | Devesh (Core) | TO FILL | |
| Agent panel and context card | Devesh (Core) | TO FILL | |
| Agent definitions and prompts | Devesh (Core) | TO FILL | |
| Cancel guard | Devesh (Core) | TO FILL | |
| Fallback policy (classifyError, runWithFallback) | Pranav (API) | TO FILL | |
| Setup, start and verify scripts | Pranav (API) | TO FILL | |
| Model matrix and second provider | Pranav (API) | TO FILL | |
| Review UI (native diff, why, accept/reject) | Vidyankshini (UI) | CHECKED | Serves virtual docs (`forgetrail-proposed://`) via `ProposedDocProvider`. `ReviewController.present` opens `vscode.diff` against the original file, reveals the hunk range, and renders the agent's rationale using an italic `whyDecoration`. Users accept via title-bar buttons or `ctrl+alt+y` (checks `document.version` against `baseVersion` to block stale edits) or reject with optional feedback. Disposing a run closes matching diff tabs and clears decorations. Demo with `ForgeTrail: Mock Review`. |
| Status bar and notifications | Vidyankshini (UI) | CHECKED | `StatusBarManager` subscribes to C8 `AgentEvent` streams, updating a status bar item with active model, pending reviews (`S_REVIEW`, clickable to show diff), model switch notices (`S_SWITCHED`), and cancellation/error statuses. `notifications.ts` implements canonical strings from BUILD_ui.md U-4, providing `showAppliedNotification` with interactive "Undo last" and "Undo run" buttons. Disposes and cleans up cleanly on run cancellation. |

---

## Part 4 — Shortlist call prep (10 minutes)

Format from the brief: walk through your code, then repeat Task A live with a model chosen by the organisers.

**Plan for the 10 minutes**

| Minutes | Who | What |
|---|---|---|
| 0–2 | Devesh | One-slide architecture talk (extension ↔ TrueForge ↔ MCP server ↔ model), eligibility points: loop on TrueForge, no direct model calls, MCP tools, approval drives review |
| 2–6 | Devesh, Pranav, Vidyankshini | Open files by module: `agents/agent.primary.json` → `src/mcp/tools/proposeEdit.ts` → `src/trueforge/runController.ts` → `src/context/…` + budget → `src/fallback/runWithFallback.ts` → `src/review/ui/reviewController.ts` |
| 6–9 | Devesh drives | Task A live with the organisers' model |
| 9–10 | All (Devesh, Pranav, Vidyankshini) | Questions |

**The 60-second model swap drill** (the organisers will give provider/endpoint, key and model name): add the key to `.env`; add or edit the provider entry in `config/models.json`; run `npm run setup -- --primary <provider/model>`; wait for `smoke-primary` PASS; run Task A. Practise it with a model you have never used. If the model is slow or thinking-style and the turn dies on the 20 s header timeout, say so honestly and switch to the next model (known limitation, V5).

**Rehearsals:** one on 15 Nov after submission, one two days before the call date (announced after results on 30 Nov). Every member must be able to explain the review flow, cancel, fallback, and context selection.

**Reset before the call:** `npm run reset:flask`, `npm run trueforge`, `npm run setup`, F5, open `src/flask/helpers.py`.

---

## Part 5 — Agent log (AI coding agents write here)

| Date / time | Agent | Launched by | Instruction (one line) | Files changed | UNCLEAR stops |
|---|---|---|---|---|---|
| 2026-11-10 10:25 IST | Antigravity | Devesh | Initial repository setup, team assignment, .gitignore creation, and git commit rules | `DECISIONS.md`, `BUILD.md`, `BUILD_api.md`, `BUILD_ui.md`, `SETUP.md`, `INTEGRATION.md`, `.gitignore` | None |
| 2026-11-10 10:50 IST | Antigravity | Devesh | Task C-0 & A-1: Scaffold extension, install local TrueForge 0.184.2, configure launch/tasks, add env/models templates | `package.json`, `package-lock.json`, `tsconfig.json`, `src/extension.ts`, `.vscode/*`, `scripts/start-trueforge.mjs`, `.env.example`, `config/models.example.json`, `DECISIONS.md` | None |
| 2026-11-10 18:35 IST | Antigravity | Devesh | Task C-2: Implement local MCP server, pathGuard, runContext, readFile, searchWorkspace tools, and unit tests | `src/mcp/*`, `src/context/ignore.ts`, `src/extension.ts`, `test/mcp.test.ts`, `package.json`, `package-lock.json`, `DECISIONS.md` | None |
| 2026-11-10 12:20 IST | Antigravity | Vidyankshini | Tasks C-1, U-1, U-2, U-3, U-4, U-5: Native diff review, virtual doc provider, why decorations, status bar, notifications, and mock review harness | `src/shared/*`, `src/apply/applyEdit.ts`, `src/trueforge/runController.ts`, `src/review/ui/*`, `src/ui/*`, `src/extension.ts`, `package.json`, `test/*`, `DECISIONS.md` | None |

## Open questions (UNCLEAR items land here)

| Date | Raised by | Task | Question | Answer / owner |
|---|---|---|---|---|
| | | | | |

---

## Part 6 — Q&A bank (rewrite each answer in your own words after the build)

1. **Why does TrueForge's approval drive the diff review?** Because the harness pauses before a tool runs; the pending call carries the full edit, we show it, and allow or deny is the user's decision. (D-005)
2. **Why one hunk per tool call?** Allow cannot modify arguments, so partial acceptance needs separate calls. (D-005)
3. **How do you guarantee no half-applied edits on cancel?** Nothing is written before Accept; apply is one atomic WorkspaceEdit; the tools check a cancelled flag before acting. (D-006, C-19)
4. **How is context selected, and what is the budget?** The agent calls suggest_context and the outline tool, reads only ranges, and the MCP server enforces about 12k estimated tokens per run, reporting what is left on every call; the panel shows files and reasons. (D-008)
5. **Why no embeddings or tree-sitter?** Native builds on Windows and extra providers are risk; budgeted lexical retrieval is enough for the repository and is explainable. (D-008)
6. **Why client-side fallback and not a proxy?** A proxy broke Gemini 3 tool-calling histories; the client-side rerun works with any provider. (D-007)
7. **How do you make sure the extension never calls a model?** It only creates sessions and sends turns to TrueForge; providers are configured in TrueForge.
8. **What happens when the model's old_text does not match?** The extension auto-denies with a standard message before any UI; after repeated failures it retries with a strict prompt, then a fallback model. (D-014)
9. **How does a user switch models?** Edit `config/models.json` and run `npm run setup -- --primary …`; each model has its own TrueForge agent.
10. **Which parts did AI tools write?** Answer honestly from Part 5 and the write-up's Tools section; every member must still explain every module.
11. **What is deferred tool loading and why only for extras?** The model sees a few meta-tools instead of every schema; applied to retrieval helpers so approval gating stays on a preloaded connector. (D-009)
12. **What breaks on slow thinking models?** A 20 s header timeout in TrueForge's local backend; flash-lite avoids it; documented as a limitation. (D-012)
13. **How does undo work and what are its limits?** Snapshots of before/after text; undo only if the file still equals the after text; Ctrl+Z also works. (C-4)
14. **What would you do with another month?** Mid-run fallback preserving history, tree-sitter outlines for more languages, CodeLens inside the diff, quota-aware routing, embeddings optional.
15. **How do you ensure the workspace is unchanged on failure?** Failures happen before any apply; proposals are only applied after Accept; the verify script checks `git status`.
