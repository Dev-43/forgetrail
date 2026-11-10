# BUILD_api.md — API teammate (Pranav): setup, models, fallback, verification, docs

> ⚠️ AGENT INSTRUCTIONS: You are building ONLY the items in this file. Nothing else. Build exactly as specified. Read BUILD.md section 0 (rules) and section 5 (contracts) first. If anything is unclear: `// UNCLEAR: [question]`, log it in DECISIONS.md "Open questions", stop that task.

## Your Scope

Everything that makes the project reproducible and resilient without touching the editor UI or the engine: scripts that start and configure TrueForge, the model configuration and provider tests, the fallback policy (pure logic, unit-tested), the Flask verification and reset scripts, the demo app, the README, the write-up drafts and the pre-submission check. You work 2–3 hours a day, so tasks are ordered by points. Your pure-logic parts need no running extension.

## Your Files

BUILD.md section 6, every row marked "API": `README.md`, `.gitignore`, `.env.example`, `config/models.example.json`, `docs/model-matrix.md`, `docs/flask-setup.md`, `docs/writeup/*` (sections 1, 2, 5, 7), `demo/*`, `scripts/*`, `src/fallback/*`, tests for your modules.

## Ground truth you must read first

The spike results files (`spike-results.md`, `spike-results-part2.md`) contain the working HTTP calls for registering providers, MCP connectors and agents, and the exact error messages for invalid key, unreachable endpoint, and the NVIDIA 404. Reuse the calls proven there. Do not invent endpoints.

## Priority order (if hours run short, drop from the bottom)

A-1, A-2, A-3, A-5, A-6, A-4 (minimal first), A-9, A-7, A-8 (full), A-4 (full matrix).

---

### A-1 Config and environment files (M0) — ~0.5 h
- What: `.env.example` listing every variable in BUILD.md C2 with placeholder values and one comment line each; `config/models.example.json` following the C3 schema with the primary (`google-gemini/gemini-3-1-flash-lite`, builtin provider, key env `GEMINI_API_KEY`) and a placeholder fallback; `.gitignore` entries for `.env`, `*.sqlite`, `node_modules`, `out`, `config/models.json`.
- Acceptance: a fresh clone + `cp .env.example .env` + `cp config/models.example.json config/models.json` gives the files setup needs; no real key anywhere (`git grep -n "AIza\|nvapi-\|gsk_\|sk-\|hf_"` finds nothing).

### A-2 Start TrueForge script (M0) — ~1.5 h
- What: `scripts/start-trueforge.mjs`, run as `npm run trueforge`. Steps: check Node ≥ 22.14 (else print "Node 22.14 or newer is required." and exit 1); spawn `npx -y @truefoundry/trueforge@0.184.2` with env `OUTBOUND_URL_ALLOWED_HOSTS=["127.0.0.1","localhost"]` and `SQLITE_PATH=./forge.sqlite` plus provider keys passed through from `.env`; wait up to 60 s for the server to respond on `http://localhost:8790`; print the URL; forward Ctrl+C to the child.
- Acceptance: from a clean clone the script prints the URL within 60 s and the TrueForge UI loads; running it with Node 20 prints the Node message.

### A-3 Setup and registration script (M0 first version, M3 flags) — ~3 h
- What: `scripts/setup.ts`, run as `npm run setup`. Reads `.env` and `config/models.json` (if missing: "Copy config/models.example.json to config/models.json." and exit 1). Steps, each printing `PASS <name>` or `FAIL <name>: <reason>`:
  1. `trueforge-reachable`
  2. `providers-registered` (from config)
  3. `connector-core` registered at `http://127.0.0.1:3333/mcp-core` (name `forgetrail-core`)
  4. `connector-extra` registered at `http://127.0.0.1:3333/mcp-extra` (name `forgetrail-extra`)
  5. `agents-upserted` — the four files in `agents/` (idempotent: create or update by name)
  6. `smoke-primary` and `smoke-fallback` — create a session on each inline agent, send "Reply with the single word: ready", pass if the reply contains `ready`
- Flags: `--break-primary` re-registers the primary provider with the key `invalid-key-for-demo`; `--no-fallback` deletes the two `-fallback` agents; `--restore` restores the real primary key and recreates the fallback agents (running with no flags also restores); `--primary <provider/model>` and `--fallback <provider/model>` override the model names in memory before upserting the agents (files on disk unchanged) — this is the 60-second drill for the organisers' model on the shortlist call.
- Exit code 0 only if every step passes. If connector registration cannot succeed while the extension is not running, print `WARN connector-core: start the extension (F5) first` and continue; do not fail.
- Acceptance: all PASS lines on a clean clone with the extension running; `--break-primary` makes `smoke-primary` FAIL with the real 401 message and `smoke-fallback` still PASS; `--restore` returns to all PASS; `--primary` with another model name changes the model shown in the TrueForge agent page.

### A-5 Fallback policy (M1–M2, pure logic) — ~3 h
- What: `src/fallback/classifyError.ts` and `src/fallback/runWithFallback.ts` with `node:test` unit tests, using only the contract in BUILD.md C9. Time must be injectable (a `sleep` function parameter) so tests do not wait.
- `classifyError(message) → kind`:

| Message contains | kind |
|---|---|
| `Cannot connect`, `ECONNREFUSED`, `ENOTFOUND`, `fetch failed` | `unreachable` |
| `(401)` or `(403)` | `auth` |
| `(404)` | `model-not-found` |
| `(429)`, `rate limit`, `quota` | `rate-limit` |
| `(500)`..`(599)`, `Headers Timeout`, `timeout` | `transient` |
| `old_text` auto-deny limit reached (RunResult.errorKind = `tool-mismatch`) | `tool-mismatch` |
| inline run finished with zero proposals (RunResult.errorKind = `no-edit`) | `no-edit` |
| edit outside selected region repeated | `region` |
| status `cancelled` | `cancelled` |
| anything else | `unknown` |

- `runWithFallback` rules (MAX_ATTEMPTS = 3 total executions; rate-limit and transient retries do not count as attempts):

| Result of an execution | Next step |
|---|---|
| done | return done |
| cancelled | return cancelled; never retry, never switch |
| `unreachable`, `auth`, `model-not-found` | switch to the fallback agent immediately (normal prompt) and emit model.switched |
| `rate-limit` | wait BACKOFF_MS[0], retry same agent; wait BACKOFF_MS[1], retry same agent; then switch to the fallback agent |
| `transient` | wait BACKOFF_MS[0], retry once; then switch to the fallback agent |
| `tool-mismatch`, `region`, `no-edit`, `unknown` | attempt 2: same agent with the STRICT addendum (BUILD_core.md); if it fails again, attempt 3: fallback agent with STRICT |
| any failure on the fallback agent (model kinds) | return error kind `no-fallback` |
| no fallback agent exists (agent missing) | return error kind `no-fallback` |
| attempts exhausted | return error kind `no-fallback` with the last message |

- Acceptance (unit tests, no network): table-driven tests covering every row above with a scripted fake `executeRun`; assert the order of agents used, the number of sleeps and their durations, the emitted model.switched events, and that cancelled never retries.

### A-6 Flask environment, verify, reset, demo app (M1–M2) — ~3 h
- `docs/flask-setup.md`: clone `pallets/flask`, check out tag 3.1.3 (commit 22d92470), create `.venv` in the clone, install Flask editable plus the test requirements per the Flask repo's own contributing instructions, confirm `pytest tests/test_cli.py -q` passes BEFORE any agent change, and explain that VS Code must be launched from a terminal with the venv activated (`code .`) so `run_command` finds `pytest`, `python`, `flask`. Include both PowerShell and bash activation lines.
- `scripts/reset-flask.ts` (`npm run reset:flask`): refuses unless `FLASK_DIR` is a git repo whose HEAD begins with `22d92470`; runs `git checkout -- .` and `git clean -fd` inside it; prints `git status --short` (must be empty) and `RESET OK`.
- `scripts/verify.ts` (`npm run verify:a`, `verify:b`, `verify:c`), all inside `FLASK_DIR`:
  - `a`: runs `python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` with env `FLASK_DEBUG=off`; prints the output; `PASS` if the trimmed output is `False`.
  - `b`: (1) `git diff --stat` must list at least 3 files; (2) `pytest tests/test_cli.py -q` must exit 0; (3) `flask --app <repo>/demo/app config` output must parse as JSON, every key containing SECRET, PASSWORD, TOKEN or KEY (case-insensitive) must have the value `***`, and at least one other key must be unmasked; (4) `flask --help` output must contain a line starting with `config`. Print each as PASS/FAIL.
  - `c`: `git status --porcelain` must be empty; print `PASS workspace unchanged` or the changed files.
- `demo/app.py`: a tiny Flask app that sets config keys `SECRET_KEY`, `DB_PASSWORD`, `API_TOKEN`, `STRIPE_KEY` (fake values) and normal keys `APP_NAME`, `REGION`. `demo/README.md`: one paragraph saying it exists only for the Task B verification.
- Acceptance: on a clean Flask 3.1.3 clone, `verify:c` passes; `verify:a` fails (prints `True`) before any edit and passes after a manual edit of `get_debug_flag` made for the test; `reset:flask` returns a modified clone to clean; the baseline `pytest tests/test_cli.py -q` passes.

### A-4 Model matrix and second provider (start M0, finish by 11 Nov for the minimal part) — ~3 h
- What: `scripts/test-models.ts` and `docs/model-matrix.md`. For each configured or candidate model, record: plain chat works; one tool call through a trivial MCP tool works (3 of 3 tries); response time; any rate-limit message seen; documented free-tier limit with its source URL; stated context window.
- Candidates, try until one works with tool calls: (1) the baseline `google-gemini/gemini-3-1-flash-lite`; (2) NVIDIA from your own account — generate a fresh key from a model's own page on build.nvidia.com, record the exact error body if it still returns 404 (Devesh's key returned 404 on all 84 listed models); (3) at least one of Groq, OpenRouter free models, Hugging Face, Token Factory — OpenAI-compatible endpoints registered as a TrueForge provider.
- Deliver a one-paragraph recommendation of the fallback model and why, then tell Devesh so C-24 can use it. Minimal version = one second model verified with tool calls.
- Post these questions in the TrueForge community Discord and paste the answers in DECISIONS.md: (V5) Is the 20 s model header timeout configurable? (V2) Does tool approval still gate a tool reached through deferred-loading meta-tools? (extra) Is stdio MCP planned for local mode?
- Acceptance: `docs/model-matrix.md` has a row per tested model with every column filled; the recommended fallback passes the 3-of-3 tool call test.
- **Model-independence test (required; it protects the shortlist call and BUILD.md C12 M9):** once the extension works (after M1), run Task A three times on every model that passes the tool-call test — at least 3 models across at least 2 providers if you can get them (record honestly if fewer) — and Task B twice on two of them. Add the columns `Task A ×3` and `Task B ×2` with pass counts and the failure reason for each miss. Do NOT add provider-specific prompts or code to rescue a model; report the failure to Devesh, who decides on general prompt changes. Only models listed with results may be claimed in the write-up.

### A-9 Pre-submission check (M3) — ~1 h
- What: `scripts/check-submission.ts` (`npm run check`). Prints PASS/FAIL for: no tracked `.env` or `*.sqlite`; no key patterns (`AIza`, `nvapi-`, `gsk_`, `sk-`, `hf_`) in tracked files; `LICENSE` exists; the four `agents/*.json` exist; `.env.example` and `config/models.example.json` exist; README contains the headings listed in A-7; `package.json` contains no `@latest`; no provider names (`gemini`, `nvidia`, `openai`, `groq`, `anthropic`, `huggingface`) in non-test files under `src/` (BUILD.md R11); `docs/model-matrix.md` exists; `docs/writeup/` exists; DECISIONS.md has at least 15 decision entries and no module in "Understanding notes" still reads `TO FILL` for a finished module.
- Acceptance: run on a deliberately dirty copy (a fake key added) → FAIL for the key line; on the clean repo → all PASS.

### A-7 README (draft M3, final M4) — ~1.5 h
- Required headings in order: What it is; Requirements (Node 22.14+, Python, VS Code, Git); Setup from a clean clone (numbered, exact commands: clone, `npm install`, copy `.env.example`, copy config, `npm run trueforge`, `npm run setup`, F5); Flask setup (link to `docs/flask-setup.md`); Run the three tasks (link to INTEGRATION.md demo path); Models and switching (how to edit `config/models.json`, `npm run setup -- --primary ...`, `--break-primary`, `--restore`); Starting point (exact sentence: "From scratch — no upstream project was forked."); Licence and credits (MIT; TrueForge is MIT and used as a dependency); Models used and cost; Known limitations (link to the write-up section).
- Acceptance: **clean-clone test by Vidyankshini (UI)** on a separate folder or machine following only the README; every problem they hit is fixed in the README and logged; they reach "Task A passes".

### A-8 Write-up drafts (M4) — ~2 h
- What: drafts of write-up sections 1 (Team: members, college, GitHub handles), 2 (Starting point: "from scratch"), 5 (Model setup: every model used, where it ran, approximate cost, how a user switches models), 7 (Tools used, including every AI assistant used to build this, listed honestly). Files `docs/writeup/01-team.md`, `02-start.md`, `05-models.md`, `07-tools.md`. Final PDF assembly: 1–3 pages, eight headings in this exact order: 1. Team, 2. Starting point, 3. Architecture on TrueForge, 4. How context is selected, 5. Model setup, 6. Scorecard, 7. Tools used, 8. Known limitations. Sections 3, 4, 6, 8 come from Devesh (C-26).
- Acceptance: PDF is 1–3 pages, headings exact and in order, opens from a public link in an incognito window.

---

## Contracts You Must Honor

BUILD.md C1 (ports, names), C2 (env), C3 (config schema), C6 (messages), C9 (`RunRequest`/`RunResult`/`executeRun`/`runWithFallback`), C10 (agent file names).

## DO NOT

- Do not build anything outside this list (no proxy, no router, no quota display, no extension UI code).
- Do not edit files owned by others (`src/` except `src/fallback/*`, `agents/*`, `package.json` except per INTEGRATION.md section 3).
- Do not call a model provider from anywhere except through TrueForge (the model-test script also goes through TrueForge sessions).
- Do not commit any key, `.env`, or `config/models.json`.
- Do not change the contract tables; propose changes to Devesh.
- Do not add packages beyond BUILD.md section 4 (`tsx` is already allowed for scripts).
