# TrueForge Day-1 Spike: Agent Brief

You are a coding agent working on Windows (PowerShell) for a hackathon team. Your job is to run 8 time-boxed tests against **TrueForge** (open-source agent harness) and record exactly what happened. A human will paste your results file into a Claude chat session, which will use it to decide the architecture. So the quality of your **evidence** matters more than speed.

## 0. Context (read once)

- Hackathon: Techfest 2026-27 "TrueFoundry Forge-a-thon". Final product is a **VS Code extension** whose agent loop runs on TrueForge.
- The extension must create sessions and send turns through the **TrueForge HTTP API or TypeScript SDK**, render streamed events, and expose editor capabilities (read file, search workspace, propose write, run command) to the agent as **MCP tools**. The extension must **never call a model provider directly**.
- This spike answers: does that architecture work? It is **not** building the extension.
- Time-box: **a few hours total**. If a test is stuck for more than 30 minutes, stop, record it as `BLOCKED` with the exact error, and move on.
- Environment: Windows, Node v22.17.1 (TrueForge needs 22.14+), TypeScript for any code you write.
- Docs index (fetch this first, it lists all pages): `https://trueforge.dev/llms.txt`
- Useful pages: `https://trueforge.dev/quickstart`, `https://trueforge.dev/api/quickstart.md`, `https://trueforge.dev/api/overview`, `https://trueforge.dev/api-reference`, `https://trueforge.dev/mcp-servers.md`, `https://trueforge.dev/create-agent/overview.md`, `https://trueforge.dev/key-features/overview.md`, `https://trueforge.dev/sessions.md`, `https://trueforge.dev/harness/initial-setup.md`
- Repo: `https://github.com/truefoundry/trueforge` (MIT, local mode on `http://localhost:8790` by default, SQLite storage).

## 1. Ground rules (non-negotiable)

1. **Never print, log or save an API key.** Keys live only in `C:\dev\forge-spike\.env` (git-ignored) or are pasted into the TrueForge UI. In every log, replace keys with `***REDACTED***`. If a command's output contains a key, redact it before saving.
2. **Never invent results.** Every claim in the results file needs evidence: the exact command, the exact output or error text (copied, not paraphrased), or a timing you measured. If you did not run something, write `NOT RUN`. If you are unsure, write `UNSURE` and say why.
3. **Record failures in full.** Errors, stack traces, HTTP status codes and response bodies are the most valuable output. Do not summarise them away.
4. **One change at a time.** Change one thing, test, record. Do not fix several things and then report only the end state.
5. **Do not skip ahead or "improve" the plan.** Run the tests in order. If a test depends on an earlier one that failed, record that and continue with what you can.
6. **Measure, don't guess.** For anything timed, note the method (stopwatch, `Measure-Command`, or event timestamps) and the number in seconds.
7. **Ask the human only when you cannot proceed** (for example, a key is missing or a UI-only action needs them). Say exactly what you need.
8. Use the docs rather than memory. TrueForge changes quickly. If the docs and this brief disagree, **the docs win**; note the difference in the results file.

## 2. Workspace layout

Create this structure:

```
C:\dev\forge-spike\
  .env                      # keys, git-ignored, never printed
  .gitignore                # must contain .env, *.sqlite, node_modules
  results\
    spike-results.md        # the ONLY file the human will paste back
    logs\                   # raw outputs, one file per test (redacted)
  mcp-test-server\          # Test 3 (TypeScript)
  sdk-scripts\              # Tests 4, 5, 8 (TypeScript)
  proxy\                    # Test 7 fallback (only if needed)
  flask\                    # clone of pallets/flask at tag 3.1.3
```

`.env` keys (the human fills these in; you only read them):

```
NVIDIA_API_KEY=
GEMINI_API_KEY=
```

Start `results\spike-results.md` from the template in Section 5 **before** running anything, and update it after every test (not at the end).

## 3. Pre-flight (5 minutes)

Record in the results file under "Environment":

```powershell
node -v
npm -v
git --version
(Get-CimInstance Win32_OperatingSystem).Caption
```

Then clone the pinned repo used by the competition's fixed tasks and verify it:

```powershell
cd C:\dev\forge-spike
git clone https://github.com/pallets/flask flask
cd flask
git checkout 3.1.3
git rev-parse --short HEAD
```

Expected short hash starts with `22d92470`. Record the actual value. If it differs, record that too.

Start TrueForge in its own terminal and leave it running:

```powershell
cd C:\dev\forge-spike
$env:SQLITE_PATH="C:\dev\forge-spike\forge.sqlite"
npx @truefoundry/trueforge@latest
```

Keep that terminal's output; save it to `results\logs\00-trueforge-console.txt` (redacted) when you finish, or copy notable lines as you go.

---

## 4. The eight tests

For each test, fill in the matching section of the results template. Status values: `PASS`, `PARTIAL`, `FAIL`, `BLOCKED`, `NOT RUN`.

### Test 1: Start it

**Goal:** TrueForge starts with one command, and we know the port and SDK package name.

Steps:
1. Confirm the command above started without errors.
2. Open `http://localhost:8790` (or the port printed in the console). Confirm the chat UI loads.
3. Find the API base path. From a second terminal:
   ```powershell
   curl.exe -i http://localhost:8790/api
   curl.exe -i http://localhost:8790/health
   ```
   Also read `https://trueforge.dev/api/quickstart.md` and `https://trueforge.dev/api-reference` to find the real base path and an unauthenticated endpoint you can call (for example, list sessions or agents). Call one with `curl.exe` and record the response.
4. Confirm the SDK package: `npm view @truefoundry/trueforge-sdk version` (also check `@truefoundry/trueforge-core` and `@truefoundry/trueforge-ui` exist).

Record: console output (first 30 lines), actual port, API base path, one successful API call with response, SDK package name and version, time from command to UI ready, any warning.

### Test 2: Connect a model (NVIDIA and Gemini)

**Goal:** both models are configured in TrueForge and can hold a chat. We learn which can do **tool calls**.

Steps (UI: Settings → Models):
1. **Gemini**: catalog provider "Google". Configure with `GEMINI_API_KEY`. Record which model IDs appear.
2. **NVIDIA**: look in the catalog first. If absent, use the **Advanced custom endpoint** / OpenAI-compatible option:
   - Base URL: `https://integrate.api.nvidia.com/v1`
   - Key: `NVIDIA_API_KEY`
   - Model ID candidates, in order: `meta/llama-3.3-70b-instruct`, `nvidia/llama-3.3-nemotron-super-49b-v1`, `qwen/qwen3-coder-480b-a35b-instruct`. Verify each ID exists at `https://build.nvidia.com/models` before trying; use the exact ID listed there.
   - Record exactly which fields the form offers, and whether it accepts a custom model ID.
3. For each model, send a plain message ("Reply with the single word: ready") and record the reply and latency.
4. **Tool-call test.** Connect the **Exa** MCP server (Settings → Connectors, no auth needed) and enable it in the chat or a Build Agent session. Then send:
   > Search the web for "pallets flask 3.1.3 release" and tell me the title of the top result.
   
   Verdict per model: `TOOL-CALLS WORK` if the session shows a real tool call and result; `NO TOOL CALLS` if it answers from memory or errors. Drop models that cannot call tools, as the lead instructed.

Record per model: provider type (catalog or custom endpoint), config fields used (no keys), plain-chat result, tool-call verdict, exact errors, latency in seconds, **free-tier rate limits hit** (HTTP 429 and so on).

### Test 3: Local MCP server (most important)

**Goal:** prove TrueForge can call tools served from a **localhost** MCP server. This is the architecture's key dependency: our VS Code extension will run an MCP server that exposes editor tools to TrueForge.

Build a tiny TypeScript MCP server in `mcp-test-server\`:
- Use the official SDK (`@modelcontextprotocol/sdk`) with the **Streamable HTTP** transport on `http://127.0.0.1:3333/mcp`.
- Tools:
  - `echo(text: string)` returns the text.
  - `read_file(path: string)` reads a file under `C:\dev\forge-spike\flask` only (reject paths outside it) and returns up to 200 lines.
  - `search_workspace(query: string)` returns up to 20 matching `file:line:text` results from the flask clone.
  - `propose_write(path: string, new_content: string)` does **not** write. It stores the proposal in memory and returns `{"staged": true, "id": "<n>"}`. This simulates how the extension will stage edits for review.
- Log every incoming request (method, tool name, args, timestamp) to the console and to `results\logs\03-mcp-server.log`.

Then, in the TrueForge UI (Settings → Connectors → **Add MCP Server**), register it by URL. Try, in order, and record the outcome of each:
1. `http://127.0.0.1:3333/mcp`
2. `http://localhost:3333/mcp`
3. If rejected, check whether the docs mention transport requirements (HTTP vs SSE, auth, HTTPS-only, header auth) and try the supported variant. Also try an SSE-style endpoint if the docs imply it.

Once connected, in a chat or Build Agent session with this server enabled, ask the agent:
> Use the search_workspace tool to find where get_debug_flag is defined, read that file with read_file, then call propose_write with the same content but with a comment added on the first line.

Record: whether registration succeeded and any validation error text; whether the tool list shows up in the UI; whether the agent actually called each tool (check the MCP server log for incoming calls, not just the UI); the exact arguments TrueForge sent; round-trip latency per call; whether stdio MCP servers are supported or only HTTP; whether the server needed to be reachable from a different host than the browser (local mode should not).

**If it fails:** capture the exact error, the docs page that says what is supported, and whether a workaround exists (for example, a tunnel). Mark clearly: **"Escalate to TrueForge Discord."** The human will ask there.

### Test 4: Approval flow

**Goal:** understand how TrueForge's tool approval works, since it should drive our per-hunk diff review.

Steps:
1. Create an agent (Build Agent) using the Test 3 MCP server. Read `https://trueforge.dev/create-agent/overview.md` for how to mark a tool **approval-required**. Mark `propose_write` as approval-required.
2. Send: "Use propose_write to add a comment on line 1 of src/flask/helpers.py."
3. **Approve (allow).** Resume. Record the outcome.
4. Repeat and **deny**. Record what the agent does after a denial (does it retry, give up, explain?).
5. Do the same flow **through the API/SDK**, not only the UI (write a script in `sdk-scripts\04-approval.ts`). This is what the extension will do. Find: how a pending approval appears in the event stream or session state, what fields the pending call carries, and the exact call to allow or deny.

Record: number of turns from request to completion for allow and for deny; wall-clock time of the pause and of the resume; **the full JSON of the pending tool call as received** (tool name, arguments, call ID, any approval ID); the exact API/SDK call used to allow and to deny; whether you can attach a **reason/message** when denying; whether approval can be set per tool and per agent; whether the large `new_content` argument is delivered intact (note the size you tested).

### Test 5: Streaming and cancel

**Goal:** learn the event types, ordering and cancel behaviour.

Write `sdk-scripts\05-stream-cancel.ts` using `@truefoundry/trueforge-sdk`:
1. Create a session, send a turn that causes a long answer plus at least two tool calls.
2. Log **every event** with a receive timestamp (ms) and its `type`. Save the raw stream to `results\logs\05-events.jsonl` (redacted).
3. After the first text delta arrives, wait 2 seconds, then **cancel** the turn through the SDK/API. Record the exact cancel call.
4. Repeat, but cancel **while a tool call is in flight** (use a slow tool on your MCP server, for example `echo` with a 10-second delay).

Record: list of distinct event types seen, in order, with one sample JSON each; time from first request to first delta; delta granularity (token or chunk); **time from cancel call to the stream stopping**; the final turn/session state after cancel; what happens to an in-flight tool call (is it aborted, or does it complete and return?); whether the session can accept a new turn after cancel; any error or dangling state.

### Test 6: Context features (sub-agent, deferred tools)

**Goal:** confirm these features work and **show clearly in the session view**, because the demo video must show them on camera.

Steps:
1. Read `https://trueforge.dev/key-features/overview.md`.
2. In Build Agent → Runtime Config, find the toggles (the quickstart mentions Dynamic sub-agents, Generative UI, Sandbox, Context compaction). Record which exist.
3. **Sub-agent:** enable it and ask a task that clearly splits, for example: "Using search_workspace, find all uses of `get_debug_flag` and all uses of `FLASK_DEBUG` in parallel and summarise each." Check the session view.
4. **Deferred tool loading:** find out how it is enabled and what triggers it (for example, many MCP tools). Add enough tools to trigger it if needed (stub extra tools on your MCP server). Check the session view.
5. Open the session view (`https://trueforge.dev/sessions.md`) and describe what is visible: turns, tool calls, sub-agents, tokens, timing.

Record: whether each feature is available in local mode; how to enable it (exact setting names); **whether it is visible in the session view, and how** (a screenshot filename is fine, saved under `results\logs\`); whether the **sandbox** is required for any of these (the competition makes it optional; Daytona needs an API key); anything that needs hosted mode.

### Test 7: Fallback

**Goal:** can TrueForge fall back to a second model automatically?

Steps:
1. Search the model setup UI and the docs for any fallback, multi-model, failover, retry or routing option. Check `https://trueforge.dev/harness/initial-setup.md` and the models page. Record exactly what you find, or "none found" with the pages you checked.
2. Test how failure behaves with the **primary model set to an invalid key**. Record: the error the user sees, the time to failure, whether TrueForge retries and how many times, and whether the session stays usable.
3. **If there is no native fallback**, test the proxy approach: write `proxy\proxy.ts`, a small local OpenAI-compatible server on `http://127.0.0.1:4000/v1` that:
   - forwards `/chat/completions` (including streaming and tool calls) to model A (for example, an unreachable URL or invalid key);
   - on error or timeout, retries against model B (the other provider's OpenAI-compatible endpoint; Gemini has one at `https://generativelanguage.googleapis.com/v1beta/openai/`);
   - logs which model served each request.
   Register `http://127.0.0.1:4000/v1` in TrueForge as an OpenAI-compatible endpoint and check that a chat, a streamed reply and a tool call all work through it.

Record: native fallback exists or not (with evidence); proxy test outcome; whether streaming and tool calls survive the proxy; added latency; any request-format problems.

### Test 8: Agent definition

**Goal:** save the agent spec so a **clean clone** can load it. The README must explain how, and the repo must contain the definition.

Steps:
1. Read the agent-spec section of the SDK docs (`https://trueforge.dev/api/quickstart.md`) and `https://trueforge.dev/agent-library.md`.
2. Find out whether an agent can be **exported** as a file (UI) or **created from a spec** (API/SDK). Capture the real spec format (JSON or YAML) with an example. Redact any secret.
3. Write `sdk-scripts\08-load-agent.ts` that reads `agent.json` (the spec) from disk and creates or updates the agent through the SDK/API, idempotently.
4. **Clean-clone test:** stop TrueForge, start it against a **fresh** SQLite file (`$env:SQLITE_PATH="C:\dev\forge-spike\fresh.sqlite"`), re-add models in the UI (or via API if possible), then run your script and confirm the agent appears and works.

Record: the agent spec format with a redacted sample; how model references are expressed (by ID? by name? will they break on another machine?); how MCP server references are expressed (URL, name); whether provider/model **configuration and keys are stored separately** from the agent spec (they must not be in the spec); the exact steps a stranger would follow; what could not be automated.

---

## 5. Results file template

Create `results\spike-results.md` with exactly this structure and fill it in as you go:

```markdown
# TrueForge Spike Results

## Environment
- OS:
- Node / npm / git:
- TrueForge version (npx @latest at time of run):
- Flask clone commit (expected 22d92470...):
- Date/time run started and finished:
- Total time spent:

## Summary table
| # | Test | Status | One-line result | Blocker or risk |
|---|------|--------|-----------------|-----------------|
| 1 | Start | | | |
| 2 | Models + tool calls | | | |
| 3 | Local MCP server | | | |
| 4 | Approval flow | | | |
| 5 | Streaming + cancel | | | |
| 6 | Sub-agent + deferred tools | | | |
| 7 | Fallback | | | |
| 8 | Agent definition | | | |

## Test 1: Start
**Status:**
**Commands run:**
**Observed:** (port, API base path, SDK package and version, timing)
**Evidence:** (exact output, redacted)
**Errors:** (verbatim, or "none")

## Test 2: Models + tool calls
(same five headings, plus a small table: model | provider type | plain chat | tool calls | latency | errors)

## Test 3: Local MCP server
(same five headings, plus: registration result per URL tried, tools visible in UI, MCP server log excerpt proving real calls)

## Test 4: Approval flow
(same five headings, plus: turns and seconds for allow and deny, FULL pending-call JSON, exact allow/deny API calls)

## Test 5: Streaming + cancel
(same five headings, plus: event type list with one sample each, cancel latency, state after cancel, in-flight tool behaviour)

## Test 6: Sub-agent + deferred tools
(same five headings, plus: how to enable, what the session view shows, screenshot filenames)

## Test 7: Fallback
(same five headings, plus: native fallback yes/no with evidence, proxy outcome)

## Test 8: Agent definition
(same five headings, plus: redacted spec sample, clean-clone steps)

## Decision impact (fill in honestly from the evidence)
| Rule | Triggered? | Evidence |
|------|-----------|----------|
| Tests 3 AND 4 pass: architecture stays as planned | yes/no | |
| Test 3 fails: need another way to expose editor tools; raise with organisers/Discord early | yes/no | |
| Test 4 awkward: per-hunk review design changes | yes/no | what exactly was awkward |
| Test 7 has no native option: proxy module becomes required | yes/no | |

## Surprises and unknowns
- (anything unexpected, undocumented behaviour, rate limits, things the docs got wrong)

## Open questions for Discord / organisers
- (specific, answerable questions with the evidence behind each)

## Raw logs index
- results\logs\... (file name: what it contains)
```

## 6. Final step: the paste-back block

When finished, print the **full contents** of `results\spike-results.md` in your final message so the human can copy it. If it is very long, print this instead, in this order:

1. Environment and the Summary table.
2. The Decision impact table.
3. For Tests 3, 4 and 5: the evidence in full (pending-call JSON, event samples, MCP log excerpt, exact errors).
4. For all other tests: Status, Observed and Errors only.
5. "Surprises and unknowns" and "Open questions".

Then run this check and report the result:

```powershell
Select-String -Path C:\dev\forge-spike\results\* -Pattern "AIza|nvapi-|sk-|Bearer " -Recurse
```

It must return nothing. If it finds anything, redact it and re-run before the human pastes the file anywhere.

## 7. Definition of done

- Every test has a status and evidence, or an explicit `NOT RUN` with the reason.
- The Decision impact table is filled in from evidence, not opinion.
- No keys appear anywhere in `results\`.
- The human can paste the file into the Claude session without editing it.
