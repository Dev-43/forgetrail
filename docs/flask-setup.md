# Flask 3.1.3 Setup & Verification Guide

This guide details how to set up the pinned Flask 3.1.3 workspace used by ForgeTrail's acceptance benchmarks (Tasks A, B, and C).

---

## 1. Prerequisites
- **Python**: 3.10, 3.11, or 3.12 installed.
- **Git**: Installed and accessible in system `PATH`.
- **Node.js**: 22.14 or newer.

---

## 2. Clone and Checkout Pinned Tag 3.1.3

Clone the official `pallets/flask` repository into the target workspace directory:

```bash
# Target directory (default: dev/forge-spike/flask or configured via FLASK_DIR in .env)
mkdir -p dev/forge-spike
git clone https://github.com/pallets/flask.git dev/forge-spike/flask
cd dev/forge-spike/flask
git checkout 3.1.3
# Confirm commit hash starts with 22d92470
git rev-parse --short HEAD
```

---

## 3. Virtual Environment Setup

Create an isolated virtual environment named `.venv` directly inside the Flask directory:

```bash
# Inside dev/forge-spike/flask
python -m venv .venv
```

### Activate the Environment:

- **PowerShell (Windows)**:
  ```powershell
  .venv\Scripts\Activate.ps1
  ```

- **Command Prompt (Windows)**:
  ```cmd
  .venv\Scripts\activate.bat
  ```

- **Bash / POSIX (macOS / Linux)**:
  ```bash
  source .venv/bin/activate
  ```

---

## 4. Install Dependencies

Install Flask in editable mode along with its test suite dependencies:

```bash
pip install --upgrade pip
pip install -e .
# Flask 3.1.3 has no requirements file; its test dependencies are listed in pyproject.toml.
# Pin pytest below 9: pytest 9 removed `_pytest.monkeypatch.notset`, which tests/test_cli.py imports.
pip install "pytest<9" asgiref greenlet python-dotenv
```

---

## 5. Baseline Verification

Confirm that the test suite passes **before** any AI coding agent runs:

```bash
pytest tests/test_cli.py -q
```
Expected output:
```text
58 passed   (count can differ slightly by platform; there must be no failures)
```

---

## 6. Launching VS Code & Terminal Environment

To ensure ForgeTrail's `run_command` MCP tool immediately discovers `pytest`, `python`, and `flask` without PATH conflicts, launch VS Code directly from a terminal session where the virtual environment is active:

```bash
# From workspace root with venv on PATH:
code .
```
ForgeTrail also automatically detects `.venv/Scripts` (Windows) or `.venv/bin` (POSIX) in the active workspace and prepends it to the child process `PATH` in `run_command`.

---

## 7. Workspace Reset & Verification Scripts

ForgeTrail provides automated scripts to inspect and restore the Flask repository:

- **Reset to clean state**:
  ```bash
  npm run reset:flask
  ```
  Runs `git checkout -- .` and `git clean -fd` inside `FLASK_DIR` after checking that HEAD matches commit `22d92470`.

- **Check clean workspace**:
  ```bash
  npm run verify:c
  ```
  Ensures `git status --porcelain` is empty.

- **Verify Task A** (Inline edit of `get_debug_flag`):
  ```bash
  npm run verify:a
  ```

- **Verify Task B** (Autonomous masked `flask config` CLI):
  ```bash
  npm run verify:b
  ```

---

## 8. Notes

- The `.venv` folder is untracked in Flask 3.1.3. `npm run reset:flask` keeps it (`git clean -fd -e .venv`) and `npm run verify:b` / `verify:c` ignore it.
