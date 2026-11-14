# UI Testing Audit Changes & Architecture Fixes

**Date:** 2026-11-14  
**Audit Context:** Live UI Testing, Retest Checklist (`docs/RETEST.md`), and Video Demo Preparation  
**Author:** Antigravity (AI Assistant) & User  
**Repository:** [ForgeTrail (forgetrail)](file:///d:/IIT_bombay)

---

## 1. Summary of Changes

During the live UI testing and retest audit, two major areas were audited, resolved, and verified:
1. **Model Provider Synchronization & Fallback Readiness (Option B)**
2. **Dynamic Multi-Hunk Inline Selection Expansion (`src/apply/applyEdit.ts`)**

Both changes adhere strictly to the project rules: zero provider names in `src/`, 100% asynchronous execution, zero-write cancel safety, and backwards-compatible test coverage (73/73 tests passing).

---

## 2. Change 1: Model Provider & Fallback Alignment

### Background & Problem
- [`config/models.json`](file:///d:/IIT_bombay/config/models.json) was originally pointing to a generic `secondary-provider` referencing a deprecated `llama-3.3-70b-versatile` model on Groq and missing the explicit `models` schema array required by TrueForge 0.184.2 for `openai-compatible` providers.
- The user chose **Option B** (fast Groq fallback), adding `SECONDARY_API_KEY=gsk_...` into [`.env`](file:///d:/IIT_bombay/.env), alongside their existing `GEMINI_API_KEY`, `GEMINI_API_KEY_BACKUP`, and `NVIDIA_API_KEY`.

### Solution & Changes
- Synchronized [`config/models.json`](file:///d:/IIT_bombay/config/models.json) with [`config/models.example.json`](file:///d:/IIT_bombay/config/models.example.json):
  ```json
  {
    "providers": [
      {
        "name": "google-gemini",
        "type": "builtin",
        "apiKeyEnv": "GEMINI_API_KEY"
      },
      {
        "name": "groq",
        "type": "openai-compatible",
        "baseUrl": "https://api.groq.com/openai/v1",
        "apiKeyEnv": "SECONDARY_API_KEY",
        "models": ["qwen/qwen3.8-27b"]
      },
      {
        "name": "nvidia",
        "type": "openai-compatible",
        "baseUrl": "https://integrate.api.nvidia.com/v1",
        "apiKeyEnv": "NVIDIA_API_KEY",
        "models": [
          { "id": "mistralai/mistral-large-4-1t-a52b", "contextLength": 131072, "maxOutputTokens": 16384 },
          { "id": "deepseek-ai/deepseek-v4.1-flash", "contextLength": 131072, "maxOutputTokens": 16384 }
        ]
      }
    ],
    "models": {
      "primary": "google-gemini/gemini-3-6-flash",
      "fallback": "groq/qwen/qwen3.8-27b",
      "agentFallback": "nvidia/mistralai/mistral-large-4-1t-a52b"
    }
  }
  ```
- **Why**:
  - `google-gemini/gemini-3-6-flash` (or `gemini-flash-lite-latest`) serves as the primary inline & agent driver.
  - `groq/qwen/qwen3.8-27b` responds in $\sim 0.8\text{s}$, providing an instantaneous fallback demo for Task C without stalls.
  - `nvidia/mistralai/mistral-large-4-1t-a52b` provides high context capacity for heavy agent tasks.
- **Verification**: Executed `npm run setup`:
  - `PASS trueforge-reachable`
  - `PASS provider-google-gemini`, `PASS provider-groq`, `PASS provider-nvidia`
  - `PASS smoke-primary`, `PASS smoke-fallback`

---

## 3. Change 2: Dynamic Multi-Hunk Inline Selection Expansion

### Problem Root Cause (Task A Failure Audit)
When executing Task A in the VS Code UI:
1. The user selected lines 28–33 of [`src/flask/helpers.py`](file:///d:/IIT_bombay/dev/forge-spike/flask/src/flask/helpers.py) (the original 6 lines of `get_debug_flag()`).
2. `executeInlineEdit` set `runContext.selectionRegion = { path: 'src/flask/helpers.py', startLine: 28, endLine: 33 }`.
3. The model generated **Hunk 1 of 2**: updating the docstring to list `"0"`, `"false"`, `"no"`, `"off"`, and `"n"`.
   - The user accepted Hunk 1.
   - Hunk 1 inserted 2 new lines. The file expanded by 2 lines.
4. The model then generated **Hunk 2 of 2**: updating `return bool(val and val.lower() not in {"0", "false", "no"})` to include `"off"` and `"n"`.
   - In the modified file, that return statement had shifted from line 33 down to line **35**.
5. When TrueForge submitted Hunk 2 for approval, [`src/trueforge/runController.ts`](file:///d:/IIT_bombay/src/trueforge/runController.ts#L162-L169) ran pre-validation:
   ```ts
   if (runContext.selectionRegion && runContext.selectionRegion.path === request.path) {
     if (request.startLine < runContext.selectionRegion.startLine ||
         request.endLine > runContext.selectionRegion.endLine) {
       return D_OUTSIDE_REGION(runContext.selectionRegion.startLine, runContext.selectionRegion.endLine);
     }
   }
   ```
6. Because `request.endLine` was 35 and `selectionRegion.endLine` was still 33 ($35 > 33$), `runController.ts` auto-denied the tool call:
   `REJECTED_AUTO: edit is outside the selected region (lines 28-33). Edit only inside it.`
7. Consequently, Hunk 2 was never presented in VS Code. The run finished with only the docstring updated, causing `npm run verify:a` to fail (`Output: True; expected False`).

### The Fix
In [`src/apply/applyEdit.ts`](file:///d:/IIT_bombay/src/apply/applyEdit.ts#L205-L210), right after a hunk is applied to disk/buffer, the active selection region boundary is dynamically adjusted by the exact line delta:

```ts
  // Adjust inline selection region bounds if lines were added or removed
  if (runContext.selectionRegion && runContext.selectionRegion.path === relPath) {
    const beforeCount = currentText.split(/\r?\n/).length;
    const afterCount = proposedText.split(/\r?\n/).length;
    runContext.selectionRegion.endLine += (afterCount - beforeCount);
  }
```

### Why this is the correct design
- **Zero manual guesswork**: The user should not have to guess and select arbitrary trailing whitespace or following functions just to prevent insertions from overflowing the selection.
- **Accurate bounding**: Any code inserted inside the selected function expands the virtual boundary of that selection, allowing subsequent hunks targeting the lower half of the function to be validated and applied cleanly.
- **Clean isolation**: The adjustment only triggers if `runContext.selectionRegion` exists and matches the edited file (`relPath`). It does not impact agent-mode runs or edits to other files.

---

## 4. Regression & Verification Results

| Suite / Test | Command | Result | Notes |
|---|---|:---:|---|
| **TypeScript Compilation** | `npm run compile` | **PASS** | 0 errors, 0 warnings. |
| **Unit Test Suite** | `npm test` | **PASS (73/73)** | All 73 tests passed in 6.2s, covering apply, undo, budget, outline, fallback, and UI. |
| **Submission Integrity** | `npm run check` | **PASS (11/11)** | Model independence in `src/` maintained; zero secrets in Git; licenses intact. |
| **TrueForge Registration** | `npm run setup` | **PASS** | All providers and agents registered; smoke tests pass. |
| **Flask Benchmark Reset** | `npm run reset:flask` | **PASS** | `dev/forge-spike/flask` cleanly restored to baseline tag 3.1.3. |
