# ForgeTrail

ForgeTrail is a local, model-independent VS Code coding assistant extension built for the Techfest 2026-27 Forge-a-thon. It connects Visual Studio Code to an autonomous local agent loop powered by TrueForge (v0.184.2) via Model Context Protocol (MCP) Streamable HTTP tools, native split diff reviews with interactive approval gating, and client-side resilient model failover.

---

## 1. What it is

ForgeTrail delivers an end-to-end pair programming experience directly inside VS Code:
- **Autonomous Agent Mode**: High-level natural language prompt execution with regex repo outline extraction, lexical file scoring, and explicit `@file:` / `@symbol:` mentions against a strictly enforced 12,000-token retrieval budget.
- **Inline Editing Mode**: Selection-bounded code modification with pre-approval validation preventing out-of-region edits or hallucinated line numbers.
- **Native Diff Review UI**: Proposed changes are presented in VS Code's native diff editor (`forgetrail-proposed://`) alongside an inline "why" explanation and one-click Accept/Reject controls.
- **Zero-Write Cancel Guard**: Cancelling a run aborts the turn in $< 100\text{ms}$, terminates the background process tree via `taskkill`, and discards unaccepted edits without writing to disk.
- **Multi-Attempt Resilient Fallback**: Classifies runtime errors (rate limits, 401s, 404s, connection drops, proposal auto-denials) and automatically fails over to secondary models with strict prompt hardening.
- **Byte-for-Byte Undo**: Every applied edit records a snapshot; changes can be rolled back via `undoLast` or `undoRun`.

---

## 2. Requirements

- **Node.js**: Version 22.14 or newer.
- **Python**: Version 3.10, 3.11, or 3.12 (with `venv`).
- **Visual Studio Code**: Version 1.93.0 or newer.
- **Git**: Installed and available in system `PATH`.
- **TrueForge**: 0.184.2 (managed locally via `package.json`).

---

## 3. Setup from a clean clone

Follow these numbered steps to run ForgeTrail from a fresh clone:

1. **Clone repository**:
   ```bash
   git clone https://github.com/Dev-43/forgetrail.git
   cd forgetrail
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   ```bash
   cp .env.example .env
   # Add your Google Gemini API key to .env (GEMINI_API_KEY=...)
   ```

4. **Configure model specifications**:
   ```bash
   cp config/models.example.json config/models.json
   ```

5. **Start the TrueForge server daemon**:
   ```bash
   npm run trueforge
   ```
   *Runs locally on `http://localhost:8790` in standalone SQLite mode.*

6. **Register models, MCP tools, and agents**:
   ```bash
   npm run setup
   ```
   *Verifies TrueForge reachability, registers MCP connectors, upserts agents, and runs smoke checks.*

7. **Launch the extension in VS Code**:
   - Open the repository folder in VS Code (`code .`).
   - Press **F5** (or select **Run > Start Debugging**) to open the Extension Development Host window.

---

## 4. Flask setup

To run the official benchmark repository (Pallets Flask 3.1.3 tag `22d92470`):
1. Review the step-by-step instructions in [docs/flask-setup.md](docs/flask-setup.md).
2. The benchmark repository is placed under `dev/forge-spike/flask`.
3. Launch VS Code from an activated virtual environment terminal so `pytest`, `python`, and `flask` are immediately discoverable.

---

## 5. Run the three tasks

ForgeTrail includes automated verification runners for all competition benchmarks:

- **Task A (Inline Edit Benchmark)**:
  ```bash
  npm run test:task-a
  ```
  Modifies `get_debug_flag` in `src/flask/helpers.py` to treat `"off"` and `"n"` as `False`, verified by `npm run verify:a`.

- **Task B (Autonomous Agent Benchmark)**:
  ```bash
  npm run test:task-b
  ```
  Adds a new built-in CLI command `flask config` masking sensitive keys (`SECRET`, `PASSWORD`, `TOKEN`, `KEY`) as `***`, verified across 4 criteria by `npm run verify:b`.

- **Task C (Resilience & Clean Workspace Benchmark)**:
  ```bash
  npm run verify:c
  ```
  Verifies that all cancelled runs and undo operations restore the workspace byte-for-byte clean.

---

## 6. Models and switching

ForgeTrail is completely model-independent: there are **zero provider-specific names** anywhere in `src/`.

- **To switch models**:
  Edit `config/models.json` (providers, keys by env-var name, and `models.primary` / `fallback` / `agentFallback` as `<provider>/<model id>`), then run `npm run setup`. Or override for one setup run:
  ```bash
  npm run setup -- --primary <provider>/<model id> --fallback <provider>/<model id>
  ```
- **Simulate primary provider outage**:
  ```bash
  npm run setup -- --break-primary
  ```
- **Restore primary model**:
  ```bash
  npm run setup -- --restore
  ```

---

## 7. Starting point

From scratch — no upstream project was forked.

---

## 8. Licence and credits

- **Licence**: Distributed under the [MIT License](LICENSE).
- **Credits**: Powered by [TrueForge](https://github.com/truefoundry/trueforge) (v0.184.2, MIT License) as a local agentic harness, and Model Context Protocol SDK by Anthropic.

---

## 9. Models used and cost

- **Primary (inline + agent mode)**: `google-gemini/gemini-3-6-flash`, Google AI Studio free tier ($0.00).
- **Inline fallback**: `qwen/qwen3.8-27b` on Groq (OpenAI-compatible), free tier ($0.00).
- **Agent-mode fallback**: `mistralai/mistral-large-4-1t-a52b` on NVIDIA build.nvidia.com (OpenAI-compatible), free credits ($0.00).
- **Total Compute Cost**: \$0.00 incurred across all runs.

Minimum model requirement: tool calling, and a context window of at least 32k tokens.

---

## 10. Known limitations

1. **Free-tier quotas**: free tiers hit 429/503 during long Task B runs. Tool calls are paced at 4.5 s in `src/mcp/server.ts`; ForgeTrail backs off and fails over to the fallback model.
2. **TrueForge Standalone 20s Header Timeout**: Pre-1.0 TrueForge standalone backend has an unconfigurable 20s header timeout. Deep-thinking models may time out if generation exceeds 20s.
3. **Keybinding**: `Ctrl+Alt+…` acts as AltGr on some Windows keyboard layouts. Use the chords instead: Inline Edit `Ctrl+K Ctrl+E` (or `Ctrl+K E`), Accept hunk `Ctrl+K Ctrl+Y`, Reject hunk `Ctrl+K Ctrl+N`; or the editor right-click menu, the ✓/✗ buttons in the diff tab, and the Command Palette. Cancel any run with "ForgeTrail: Cancel Run" or by clicking the status bar item.
4. **Single Active Run Concurrency**: The run controller enforces single-run isolation to prevent concurrent file corruption.
5. **Regex Symbol Outlines**: Symbol definitions are extracted for Python, TypeScript, and JavaScript.
