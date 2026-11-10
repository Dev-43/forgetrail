# SETUP.md — Machine check (every teammate runs this on their own machine)

Purpose: confirm that your machine has everything needed to build and run ForgeTrail, before any of us writes code on it. This is a checklist you run by hand: do each step, compare with **Expected**, mark PASS or FAIL, then send the **Report block** (Part 6) to Devesh in the team chat. Nothing here changes the repository.

Later, `npm run setup` and `npm run check` (built by the API teammate) will automate parts of this. This file stays the source for machine-level checks.

## Part 0 — Rules

1. **Never paste an API key into chat, a commit, an issue or an AI assistant.** Keys live only in `.env` (git-ignored) or in the TrueForge Settings screen on your own machine.
2. Commands are shown for **Windows PowerShell (A)** and **macOS/Linux bash (B)**. Use the one that matches your machine.
3. If you use an AI assistant to help run this file: give it this file, tell it to run only the listed commands, report raw output, and never print or request keys.
4. A FAIL is useful information. Do not work around it silently: write the exact error text in the Report block.
5. Folders: keep the Flask clone and the ForgeTrail repo as two separate folders (for example `~/work/flask` and `~/work/forgetrail`). Run TrueForge from a third place (for example `~/work/tf-run`) so its database file does not land in either repo.

---

## Part 1 — Tools (all three people)

| ID | Check | Command (A = PowerShell, B = bash) | Expected | If it fails |
|---|---|---|---|---|
| S1 | Node 22.14 or newer | `node --version` | `v22.14.0` or higher | Install Node 22 (22.14+) from nodejs.org or via nvm, reopen the terminal |
| S2 | npm works | `npm --version` | Any version number | Comes with Node; reinstall Node |
| S3 | Git works | `git --version` | `git version 2.x` | Install Git |
| S4 | Python 3.9 or newer | A: `python --version` (or `py --version`)  B: `python3 --version` | `Python 3.9` or higher | Install Python 3.9+; on Windows tick "Add to PATH" |
| S5 | VS Code with the `code` command | `code --version` | Version number on the first line; write it down | In VS Code: Command Palette → "Shell Command: Install 'code' command in PATH" |
| S6 | Network reachable | A: `curl.exe -I https://registry.npmjs.org` then `curl.exe -I https://github.com` then `curl.exe -I https://generativelanguage.googleapis.com`  B: same with `curl` | Each prints an HTTP status line (any status, even 404, means reachable) | Check Wi-Fi, VPN, proxy; tell Devesh which host failed |
| S7 | Ports 8790 and 3333 are free | A: `Get-NetTCPConnection -LocalPort 8790,3333 -ErrorAction SilentlyContinue`  B: `lsof -i :8790 -i :3333` | No output | Close the program using the port, or note which program it is |
| S8 | Git identity and GitHub access | `git config user.name` and `git config user.email`, then `git ls-remote https://github.com/pallets/flask.git HEAD` | Name and email printed; the second prints a commit hash | `git config --global user.name "Your Name"` and the same for `user.email`; fix network if the hash does not print |

---

## Part 2 — Flask baseline (all three people)

The three fixed tasks run on `pallets/flask` at tag 3.1.3 (commit 22d92470). Every machine must be able to run it.

| ID | Check | Command | Expected | If it fails |
|---|---|---|---|---|
| S9 | Clone and check out the tag | `git clone https://github.com/pallets/flask.git` then `cd flask` then `git checkout 3.1.3` then `git rev-parse HEAD` | The hash printed **starts with `22d92470`** ("detached HEAD" message is normal) | Wrong hash: you are not on the tag; run `git checkout 3.1.3` again and tell Devesh |
| S10 | Create and activate a virtual environment inside the Flask folder | A: `python -m venv .venv` then `.venv\Scripts\Activate.ps1`  B: `python3 -m venv .venv` then `source .venv/bin/activate` | Prompt starts with `(.venv)` | PowerShell blocks the script: run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` and activate again |
| S11 | Install Flask (editable) and the test requirements | `pip install -e .` then `pip install -r requirements/tests.txt` then `flask --version` | No errors; version output includes `Flask 3.1.3` | If `requirements/tests.txt` does not exist: run `pip install pytest` and write that in the Report block |
| S12 | Baseline tests pass | `pytest tests/test_cli.py -q` | Ends with `N passed` and no failures (write down N) | Failures before any change mean the environment is wrong; paste the last 20 lines |
| S13 | Task A baseline behaves as expected | A: `$env:FLASK_DEBUG="off"; python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` then `Remove-Item Env:FLASK_DEBUG`  B: `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` | Prints `True` (before the agent's change, `off` is not recognised as false; the task makes it `False`) | Prints `False`: you are not on the 3.1.3 code; recheck S9 |
| S14 | VS Code started from the venv finds the tools | With the venv active, run `code .` inside the Flask folder; in the VS Code terminal run A: `where.exe pytest`  B: `which pytest` | The path printed is inside the Flask `.venv` folder | Path is elsewhere or empty: close VS Code, activate the venv in a terminal, run `code .` from that terminal again |

---

## Part 3 — TrueForge (all three people; S19 is required for the API teammate)

| ID | Check | Command / action | Expected | If it fails |
|---|---|---|---|---|
| S15 | Start the pinned TrueForge | In your third folder. A: `$env:OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]'; $env:SQLITE_PATH="$PWD\forge.sqlite"; npx -y @truefoundry/trueforge@0.184.2`  B: `export OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]'; export SQLITE_PATH="$PWD/forge.sqlite"; npx -y @truefoundry/trueforge@0.184.2` | Starts and stays running; terminal shows the local address (port 8790) | Node too old (S1); port busy (S7); network (S6). Never use `@latest` |
| S16 | The UI loads | Open `http://localhost:8790` in your browser | TrueForge UI appears with no login | Check the terminal for errors; paste them |
| S17 | A model answers | In the UI: Settings → Models → add the Gemini provider with your own free key from Google AI Studio → New Chat → select `google-gemini/gemini-3-1-flash-lite` → send: `Reply with the single word: ready` | Reply contains `ready` within about 5 seconds | 401: key wrong; 404: model name wrong; paste the exact message (never the key) |
| S18 | The session is recorded | Open Sessions in the UI | Your chat appears with the model name, tokens and duration | Refresh; tell Devesh if absent |
| S19 | A second provider or model answers | Add one more provider with your own key (NVIDIA from a freshly generated key on build.nvidia.com, or Groq, OpenRouter, Hugging Face, Token Factory) or a second Gemini model → New Chat → same `ready` test | Reply contains `ready` | Paste the exact error text and the provider name; this feeds the model matrix (A-4) |

---

## Part 4 — Project repo (after Devesh pushes the scaffold; checks marked "later" wait for their task)

| ID | Check | Command / action | Expected | If it fails |
|---|---|---|---|---|
| S20 | Clone and install | Clone the team repo into its own folder, then `npm install` | Finishes without errors | Node version (S1); paste the last 20 lines |
| S21 | Compile | `npm run compile` | No errors | Paste errors |
| S22 | Extension Development Host starts | Open the repo in VS Code, press **F5**; in the new window open the Command Palette and run `ForgeTrail: Hello` | A window opens and a message appears | F5 does nothing: select "Run Extension" in the Run and Debug panel; paste errors |
| S23 (later) | Start and configure script | `npm run trueforge` in one terminal, `npm run setup` in another (after the API teammate delivers A-2 and A-3) | Every step prints `PASS` (a `WARN connector` line is fine if the extension is not running) | Paste the FAIL lines |
| S24 (later) | Task A works | After Devesh's M1 | Per BUILD_core.md C-8 | Paste what you saw |

---

## Part 5 — Role extras

| ID | Who | Check | Expected |
|---|---|---|---|
| S25 | Vidyankshini (UI) | In VS Code Keyboard Shortcuts, search for `ctrl+alt+e`, `ctrl+alt+y`, `ctrl+alt+n` (macOS `cmd+alt+…`) | No default binding already uses them; if one does, write which |
| S26 | Vidyankshini (UI) | Switch the theme to a dark one and a light one and open any diff | Diff colours are readable in both |
| S27 | Devesh (Core) | A screen recorder is installed and records 1080p or higher; a browser window is available for the TrueForge sessions page | A 10-second test recording plays back clearly |
| S28 | Devesh (Core) | In the Flask folder: `git describe --tags` | `3.1.3` |
| S29 | Pranav (API) | Your own provider keys: Gemini free key created; at least one second provider account created | Keys saved in your local `.env` only |

---

## Part 6 — Report block (copy, fill, send to Devesh)

```
Name:                      Role: Core (Devesh) / API (Pranav) / UI (Vidyankshini)
OS + version:              
Shell used:                (PowerShell / bash)
Node:                      Python:                 VS Code:
Flask commit (S9):         pytest baseline N passed (S12):

S1 _  S2 _  S3 _  S4 _  S5 _  S6 _  S7 _  S8 _
S9 _  S10 _ S11 _ S12 _ S13 _ S14 _
S15 _ S16 _ S17 _ S18 _ S19 _
S20 _ S21 _ S22 _ (S23, S24 later)
Role extras (S25–S29): _

First failure, exact text (no keys): 
Anything unusual (proxy, VPN, antivirus, corporate laptop, low disk):
```

Use PASS, FAIL or N/A for each. When all of Parts 1–3 are PASS on all three machines, the team is ready to build.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Activate.ps1 cannot be loaded` | PowerShell execution policy | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` |
| `code` not recognised | Command not on PATH | Command Palette → "Shell Command: Install 'code' command in PATH", reopen the terminal |
| `pytest` not found inside VS Code | VS Code started outside the venv | Activate the venv in a terminal and run `code .` from it |
| `npx` hangs or fails | Network, proxy or old Node | Check S1 and S6; try another network |
| TrueForge starts but port is different | 8790 was busy | Free the port (S7) and restart; the plan assumes 8790 |
| 401 on the model test | Wrong or expired key | Create a new key; paste it only into the Settings screen or `.env` |
| 404 on the model test | Model name not valid for that key | Copy the model name from the provider's own page; report the exact message |
| `git clone` is very slow or fails | Network | Retry; use a mobile hotspot if needed |
