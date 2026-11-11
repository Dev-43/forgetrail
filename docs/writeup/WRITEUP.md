# ForgeTrail — Techfest 2026-27 Forge-a-thon Submission Write-Up

---

## 1. Team

| Name | Role | GitHub Handle | Primary Responsibilities |
|---|---|---|---|
| **Devesh Dolas** | Core Engine | [`@Dev-43`](https://github.com/Dev-43) | MCP HTTP Server (`:3333`), TrueForge client bridge, RunController state machine, atomic applyEdit, undoStore, retrieval budget, panel webview, and cancel guard. |
| **Pranav Gaikwad** | API & Verification | [`@Pranav1632`](https://github.com/Pranav1632) | Provider/connector registration (`scripts/setup.ts`), model matrix benchmarking, fallback policy (`runWithFallback`), pre-submission check script, and Flask setup documentation. |
| **Vidyankshini Vibhute** | UI & Diff Review | [`@VIDYANKSHINI`](https://github.com/VIDYANKSHINI) | Native VS Code diff review presenter (`ReviewController`), proposed doc provider (`forgetrail-proposed://`), why-decorations, status bar manager, and notifications. |

- **Institution:** Indian Institute of Technology Bombay (IIT Bombay)
- **Competition:** Techfest 2026-27 Forge-a-thon (TrueForge Track)
- **Repository:** [https://github.com/Dev-43/forgetrail](https://github.com/Dev-43/forgetrail)

---

## 2. Starting Point

**From scratch — no upstream project was forked.**

ForgeTrail was conceived, architected, and built entirely from an empty git repository initialized for the Techfest 2026-27 Forge-a-thon. 

- **No Upstream Templates or Boilerplate Forks**: The VS Code extension skeleton was created directly using standard VS Code Extension APIs with strict TypeScript compilation (`tsconfig.json`).
- **No Third-Party Diff Libraries**: All diff rendering utilizes the VS Code native diff editor (`vscode.diff`) and virtual text documents (`forgetrail-proposed://`), avoiding external diff dependencies or custom webview diff clones.
- **Zero Copied Code**: All components—including the Streamable HTTP MCP server, the lexical context retrieval engine, the regex-based symbol extractors, and the atomic hunk undo stack—were authored from first principles in compliance with project rule R5.

---

## 3. Architecture on TrueForge

```mermaid
graph TD
    subgraph VS Code Extension Host
        UI[Native Diff Editor & Status Bar]
        Panel[Agent Webview Panel]
        RC[RunController State Machine]
        MCP[Local MCP Server :3333]
        Undo[Atomic Apply & UndoStore]
    end

    subgraph TrueForge Local Daemon :8790
        Engine[Agent Turn Orchestrator]
        Catalogs[Model Providers & Connectors]
        DB[(forge.sqlite)]
    end

    subgraph Model Providers
        Primary[Google Gemini / Primary Model]
        Secondary[Fallback models: Groq / NVIDIA]
    end

    Panel -->|instruction| RC
    UI -->|accept / reject| RC
    RC -->|sessions.createTurnStream| Engine
    Engine -->|mcp-session-id Streamable HTTP| MCP
    MCP -->|pathGuard, 12k budget| RC
    Engine -->|LLM calls| Primary
    Engine -.->|fallback failover| Secondary
    RC -->|WorkspaceEdit snapshot| Undo
```

### Architectural Principles
1. **Isolated CommonJS/ESM Bridge**: The VS Code Extension Host (CommonJS) bridges with `@truefoundry/trueforge-sdk` through dynamic ESM imports, eliminating packaging conflicts.
2. **Streamable HTTP Session Multiplexing**: MCP endpoints `/mcp-core` and `/mcp-extra` on port 3333 maintain session state keyed on `mcp-session-id`, preventing "Server already initialized" conflicts across multi-turn agent runs.
3. **Approval-Driven Review**: Proposed edits trigger TrueForge `tool.approval_required` events, pausing the loop server-side while the user reviews the diff in the native split editor.
4. **Clean Cancel & Process Tree Cleanup**: Invoking `cancelRun()` synchronously sets a cancel guard, issues `client.sessions.cancel()`, closes open review diffs, and executes `taskkill /pid <PID> /T /F` on Windows to guarantee zero orphaned subprocesses.

---

## 4. How Context is Selected

ForgeTrail uses a budgeted lexical retrieval pipeline rather than heavy native embeddings or vector stores:

### 1. The 12,000-Token Budget (`RUN_RETRIEVAL_MAX_TOKENS`)
Every retrieval tool (`read_file`, `search_workspace`, `repo_outline`, `suggest_context`) computes an estimated token size (`ceil(chars / 4)`). Every read deducts from the 12,000-token budget. If exhausted, further reads return `E_BUDGET`, forcing the agent to proceed with accumulated context.

### 2. Outline Extraction (`repo_outline`)
Extracts class, function, and method signatures using regex definitions across Python, TypeScript, and JavaScript. Outlines are scored by keyword hits and bounded to 1,500 tokens (`OUTLINE_MAX_TOKENS`).

### 3. Relevance Ranking (`suggest_context`)
Analyzes user instructions, extracts search keywords, and ranks candidate files across three categories:
- Source implementation files (`src/`, `flask/`)
- Test suites (`tests/`)
- Documentation files (`docs/`)
Ranks up to 8 candidate files (`SUGGEST_MAX_FILES`) with explicit reasons and token sizes.

### 4. Explicit Mentions (`@file:` and `@symbol:`)
Users can attach explicit context directly into prompts:
- `@file:<path>` extracts up to 200 lines, appending outline summaries if truncated.
- `@symbol:<name>` resolves symbol definition blocks with line coordinates.
Both inject blocks under `ATTACHED CONTEXT` and display in the panel's "Context Chosen" card.

---

## 5. Model Setup

### Models used

All models are configured in TrueForge (catalog provider or OpenAI-compatible endpoint) by `npm run setup` from `config/models.json`; the extension never calls a provider.

| Role (agent) | Model | Where it runs | Cost |
|---|---|---|---|
| Primary, inline + agent mode (`forgetrail-*-primary`) | `google-gemini/gemini-3-6-flash` | Google AI Studio, free tier | $0.00 |
| Inline fallback (`forgetrail-inline-fallback`) | `qwen/qwen3.8-27b` | Groq, OpenAI-compatible endpoint, free tier | $0.00 |
| Agent-mode fallback (`forgetrail-agent-fallback`) | `mistralai/mistral-large-4-1t-a52b` | NVIDIA build.nvidia.com, OpenAI-compatible endpoint, free credits | $0.00 |
| Used during development | `google-gemini/gemini-3-1-flash-lite` | Google AI Studio, free tier | $0.00 |

Model probe on 2026-11-11 (plain reply + one `read_file` tool call through TrueForge): `gemini-3-5-flash-lite`, `gemini-3-5-flash`, `gemini-3-6-flash` and `gemini-flash-lite-latest` passed in 2–10 s; `gemini-3-7-flash` hit TrueForge's 20 s header timeout; `gemini-3-8-flash` returned 503 (high demand); `gemini-3-1-flash-lite`, `gemini-flash-latest` and `gemini-3-1-pro-preview` returned 429 (free-tier quota). On Groq, `llama-3.3-70b-versatile` is no longer offered and `openai/gpt-oss-120b` fails in TrueForge on multi-turn requests (`reasoning_content` rejected), so `qwen/qwen3.8-27b` is used.

*Total inference cost across build and testing: $0.00 (free tiers only).*

### How a user switches models

1. Put the provider's key in `.env` (any variable name).
2. In `config/models.json`, add or edit an entry in `providers` (`builtin` for a TrueForge catalog provider; `openai-compatible` with `baseUrl` and the model ids otherwise) and point `models.primary` / `models.fallback` / `models.agentFallback` at `<provider>/<model id>`.
3. Run `npm run setup` (or, without editing the file, `npm run setup -- --primary <provider>/<model id>`). Setup registers the providers, creates the four agents and prints `PASS smoke-primary` / `PASS smoke-fallback` when both models answer.

---

## 6. Scorecard

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

---

## 7. Tools Used

In accordance with rule R4 and competition guidelines, all software tools, runtime environments, and AI coding assistants used in the conception, development, and testing of ForgeTrail are honestly disclosed below:

### 1. Developer Environment & Runtimes
- **IDE:** Visual Studio Code (Extension Development Host engine `^1.93.0`).
- **Runtime:** Node.js v22.17.1 on Windows 11 (PowerShell 5.1 / 7).
- **Language / Tooling:** TypeScript 5.7.3 (`strict: true`), compiled with native `tsc` without third-party bundlers.
- **Script Execution:** `tsx` (TypeScript Execute) for zero-compilation script execution.
- **Test Harnesses:** `node:test` built-in test runner for pure logic unit testing; Python 3.12 virtual environments with `pytest` for Flask 3.1.3 baseline verification.

### 2. Core Agent Framework & Libraries
- **TrueForge Daemon:** `@truefoundry/trueforge` pinned at version `0.184.2` running in local standalone mode.
- **TrueForge Client SDK:** `@truefoundry/trueforge-sdk` pinned at `0.184.1`.
- **Model Context Protocol:** `@modelcontextprotocol/sdk` (Streamable HTTP transport) for bidirectional tool serving.

### 3. AI Coding Assistants (Full Disclosure)
- **Claude (Anthropic)**: Utilized during initial project inception (M0) for architectural scoping, requirements mapping, and contracts formalization in `DECISIONS.md` (`D-001`).
- **Antigravity (Google DeepMind)**: Primary autonomous and pair-programming AI coding assistant utilized across Milestones M0, M1, M2, M3, and M4 for codebase implementation, MCP tool integration, native diff review wiring, resilience policies, and automated verification suites.
  - Every single AI execution turn, instructions received, files touched, and UNCLEAR checkpoints were logged in real-time in [DECISIONS.md](../../DECISIONS.md) Part 5 ("Agent log").

---

## 8. Known Limitations

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
