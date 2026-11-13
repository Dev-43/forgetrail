# Retest checklist: fixes from the 2026-11-13 UI test

The UI test on 2026-11-13 found the bugs below; they are fixed in code and covered by unit tests where possible (`npm test`: 73/73). What unit tests cannot show (the real VS Code editor, a real model) is listed here. It takes about 30–40 minutes, most of it waiting for Task B.

Write the result of every **Check** in the table at the end (PASS / FAIL + what you saw; a screenshot for any FAIL).

## 0. Setup (5 min)

1. `git pull`, then in the `forgetrail` folder: `npm install`, `npm run compile`, `npm test` (expect 73 pass).
2. `npm run trueforge` in its own terminal; leave it running.
3. `npm run setup`. All lines PASS. (If Gemini answers 429 on the free tier, use `npm run setup -- --primary nvidia/mistralai/mistral-large-4-1t-a52b`; any working model is fine for this retest.)
4. `npm run reset:flask`.
5. **Close every other VS Code window that runs ForgeTrail** (an Extension Development Host left open keeps port 3333 with old code).
6. Open the `forgetrail` folder in VS Code, press **F5**. In the new "[Extension Development Host]" window: File → Open Folder → `forgetrail/dev/forge-spike/flask`.

Task A instruction (inline edit, select lines 28–33 of `src/flask/helpers.py`, the whole `get_debug_flag` function):

```
Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.
```

Task B instruction (agent panel):

```
Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test in tests/test_cli.py, and be documented alongside the other built-in commands.
```

## 1. Shortcuts (B1) — 2 min

1. Open `src/flask/helpers.py`, select lines 28–33, press **Ctrl+K**, then **Ctrl+E** (keep Ctrl held for both keys).
   **Check:** the Inline Edit box opens. Press Escape to close it.
2. Same, but **Ctrl+K**, release, then **E**. **Check:** the box opens.
3. Run Task A, and when the diff tab opens click inside its right-hand side and press **Ctrl+K Ctrl+Y**.
   **Check:** the hunk is accepted (same as the ✓ button). Accept the rest with ✓.
4. `npm run reset:flask` (or Undo run from the notification).

## 2. Task B in the panel: parallel edits, Undo Run, panel cards (P3, P1, P2, C1–C3) — 15 min

1. Ctrl+Shift+P → **ForgeTrail: Open Agent Panel**, paste the Task B instruction, click **Run**.
2. While it runs:
   - **Check (P1):** the Tool Execution Trail has **one row per call** (no `unknown_tool` rows, no row with `("")`); rows show the path or command (e.g. `src/flask/cli.py:560-620`, `python -m pytest …`) and turn **✓ ok** / **✗ failed** when the call finishes. When the run ends, no row is left on "running…".
   - **Check (P2):** the **Context Chosen** card lists every `CONTEXT:` file the transcript shows, **including `src/flask/cli.py`**, with the full reason (not cut off) and a token count only for files the agent read (no "~100t" everywhere).
   - **Check (P2):** the transcript has line breaks between messages (no "commands.Let me check").
   - **Check (C1):** no "Run command?" dialog while the agent is exploring; the first one, if any, is for pytest / python.
3. Accept every diff (✓). Several hunks for `src/flask/cli.py` come in one batch; this is where the bug was.
   - **Check (P3):** **no** "Failed to save 'cli.py': The content of the file is newer" message.
   - **Check (P3):** the agent does **not** re-propose a hunk saying a previous one "was dropped".
4. If a "Run command? python -m pytest …" dialog appears, click Run.
   **Check (C3):** the agent's final message does not mention "pre-existing failures"; pytest runs in the Flask `.venv` (60 passed).
5. When the badge says DONE: in a terminal in `forgetrail`, run `npm run verify:b`. **Check:** 4 × PASS.
6. Click **Undo Run** in the panel.
   **Check (P3):** notification "Reverted N hunk(s) …" (no "Stopped undo after …"), then `npm run verify:c` → `PASS workspace unchanged`.

## 3. A question from the model (R8) — 5 min

The built-in question tool is now switched off in all four agents (`config.ask_user_questions.enabled: false`), and ForgeTrail answers it if a model still asks. To provoke the old failure:

1. Run Task A. On the **first** diff click ✗ and type a cryptic reason: `dpn`, Enter. Reject the second hunk with `dpn` too.
2. **Check (R8):** the agent comes back with a new proposal (or ends the run). If a box titled **"ForgeTrail: the agent asks"** appears, pick any option; that is the new handler working.
3. **Accept** the new proposal. **Check:** it is written to `helpers.py` and the run ends with "applied N hunk(s)". It must **not** silently start over with a fresh first proposal (that was the bug).
4. Undo run from the notification; `npm run verify:c` → PASS.

## 4. Reject box and notifications (U1, U2) — 3 min

1. Run Task A. On the first diff click ✗; while the "Why?" box is open, click ✗ again.
   **Check (U2):** still only one "Why?" box. Press Enter (reject without a reason), then reject the next hunk too.
2. **Check (U1):** when the run ends, the notification "applied 0 hunk(s)" has **no** Undo buttons.
3. Run Task A again; while the "Why?" box is open for a hunk, press **Stop** (status bar item or Ctrl+Shift+P → ForgeTrail: Cancel Run).
   **Check (U2):** the "Why?" box closes by itself.
4. `npm run verify:c` → PASS.

## 5. Regression: the earlier passes still pass — 5 min

1. `npm run setup -- --break-primary` then Task A: **Check:** status bar "… failed, switched to …", fallback diff appears; reject everything; `verify:c` PASS.
2. `npm run setup -- --break-primary --no-fallback` then Task A: **Check:** "ForgeTrail: the model could not be reached. Nothing was changed. Check your model settings."
3. `npm run setup` to restore.

## Results

| Step | Check | Result | Notes |
|---|---|---|---|
| 1.1 | Ctrl+K Ctrl+E opens Inline Edit | | |
| 1.2 | Ctrl+K E opens Inline Edit | | |
| 1.3 | Ctrl+K Ctrl+Y accepts | | |
| 2.2 | P1 tool trail: one row per call, closes | | |
| 2.2 | P2 context card complete, cli.py listed, real tokens | | |
| 2.2 | P2 transcript line breaks | | |
| 2.2 | C1 no command dialogs while exploring | | |
| 2.3 | P3 no "Failed to save", no dropped hunk | | |
| 2.4 | C3 pytest in .venv | | |
| 2.5 | verify:b 4 × PASS | | |
| 2.6 | P3 Undo Run complete, verify:c PASS | | |
| 3 | R8 accept after a question is applied, no silent restart | | |
| 4.1 | U2 one Why? box | | |
| 4.2 | U1 no Undo buttons on 0 applied | | |
| 4.3 | U2 Why? box closes on Stop | | |
| 5.1 | Fallback switch, workspace clean | | |
| 5.2 | No-fallback message | | |

## What changed (for reference)

| Bug | Fix | Files |
|---|---|---|
| R8 | Answers `tool.response_required` (ask_user_question → QuickPick; other client tools → error text) in the same batch as the approvals; agents switch `ask_user_questions` and `generative_ui` off; a refused batch now says "N accepted hunk(s) were NOT applied" | `src/trueforge/runController.ts`, `src/trueforge/clientTools.ts`, `src/trueforge/client.ts`, `agents/*.json` |
| P3 | Root cause: TrueForge runs approved `propose_edit` calls in parallel, so hunks on one file raced. Applies are now queued per file, use the open document's text, and check that the save worked (disk write if not); undo does the same | `src/apply/applyEdit.ts`, `src/apply/undoStore.ts` |
| P1 | One trail row per tool call (streamed fragments are assembled), closed by `toolCallId`; rows still open at the end of a run are marked "— no result" | `src/trueforge/eventMapper.ts`, `src/panel/webview/main.js`, `src/shared/contracts.ts` (optional `toolCallId`) |
| P2 | CONTEXT lines parsed only when complete; line break added between messages; paths with hyphens/backticks; real read_file token sums | `src/trueforge/eventMapper.ts`, `src/panel/webview/main.js` |
| C1 | Agent rule: run_command only for tests / the changed program | `agents/agent.*.json` |
| C2 | run_command description names the shell (cmd.exe on Windows) | `src/mcp/tools/runCommand.ts`, `src/mcp/server.ts` |
| C3 | `.venv` put on the real `Path` key on Windows, `VIRTUAL_ENV` set | `src/mcp/tools/runCommand.ts` |
| U1 | No Undo buttons when 0 hunks were applied | `src/ui/notifications.ts` |
| U2 | One "Why?" box at a time; closed when the run ends or the hunk is accepted | `src/review/ui/reviewController.ts` |
| B1 | Chords `Ctrl+K Ctrl+E` (inline edit), `Ctrl+K Ctrl+Y` / `Ctrl+K Ctrl+N` (accept / reject) | `package.json`, `README.md` |
