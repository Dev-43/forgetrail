# RECORDING_SCRIPT.md — Demo video (maximum 4:00)

Built from the brief's rules and the current status report (18 Nov, build verified). Record each segment as its own clip, then join the clips in order. Per-segment takes make retakes cheap and keep every clip honest.

## 0. Rules from the brief (do not break)

- Tasks A, B, C in that order; each followed by its on-screen verification.
- The TrueForge session for Task B is shown briefly (turns and tool calls).
- You may cut model waiting time, but **never cut between giving an instruction and the diff appearing.** Do not speed up that stretch either.
- Maximum 4:00. Public link (YouTube unlisted, or Drive with "anyone with the link can view").
- The undo and cancel clips are extra evidence for the rubric. They go inside the 4:00 and never change the A, B, C order.

## 1. Pre-flight (do all of it before the first take)

1. Flask clone: `git describe --tags` prints `3.1.3`; `git status` clean; virtual environment active; VS Code started from that terminal (`code .`) so `pytest`, `python` and `flask` resolve.
2. TrueForge running (`npm run trueforge`); `npm run setup` all PASS, including `smoke-primary` and `smoke-fallback`.
3. Recording happens in the Extension Development Host window (F5).
4. Browser tab pre-opened at `http://localhost:8790/sessions`.
5. Screen: 1080p or higher, editor zoom raised so text is readable on a phone, minimap off, sidebar collapsed, notifications cleared, Do Not Disturb on. Close `.env` and any settings page: **no key may ever appear on screen.**
6. Paste-ready text in a scratch note (not in the repo): the exact Task A instruction, the exact Task B instruction, and the verification commands below.
7. **Quota check.** Free tiers run out. Check your Gemini, Groq and NVIDIA usage pages before you start. Do at most one timed rehearsal, then record fresh (daily limits reset around midnight Pacific time, which falls in the afternoon in India; confirm on the usage page).
8. Time one full rehearsal against the budget in section 2.

Exact instructions (paste, never type):

- Task A: `Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.`
- Task B: `Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.`

Verification commands (Windows PowerShell; run in the Flask clone):

- Task A: `$env:FLASK_DEBUG="off"; python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` → `False`
- Task B: `git diff --stat`, then `pytest tests/test_cli.py -q`, then `flask --app <path to demo/app> config`, then `flask --help`
- Task C and cancel: `git status`

Show the raw commands on screen (the judges compare them with the brief). `npm run verify:a/b/c` can be used in addition, not instead.

## 2. Time budget

| Clip | Window | Seconds |
|---|---|---|
| S0 Tag check | 0:00–0:05 | 5 |
| S1 Task A | 0:05–0:50 | 45 |
| S2 Undo | 0:50–1:00 | 10 |
| S3 Task B | 1:00–2:30 | 90 |
| S4 TrueForge session | 2:30–2:40 | 10 |
| S5 Task C | 2:40–3:25 | 45 |
| S6 Cancel | 3:25–3:50 | 25 |
| S7 End card | 3:50–3:58 | 8 |

If the rehearsal is over 3:55, cut in this order: narration length, then pace of hunk review in S3 (still pause on the first hunk's "why"), then S6 down to 15 s. Never trim the uncut instruction-to-diff stretches and never drop a task.

## 3. Clip scripts

Narration is optional; keep it to the lines below. Speak slowly. Captions are fine instead.

### S0 — Tag check (5 s)
- Screen: terminal in the Flask clone.
- Do: `git describe --tags`.
- Say: "This is Flask 3.1.3, the pinned repository."
- Visible: `3.1.3`.

### S1 — Task A: inline edit (45 s) · A1, A3, B2
- Do: open `src/flask/helpers.py`; select the whole `get_debug_flag` function; press **Ctrl+K Ctrl+E**; paste the Task A instruction; press Enter. **From this moment, no cuts until the first diff appears.**
- The native diff opens with the "why" line and the hunk counter. Pause 3 s on the why. Accept hunk 1 (title-bar button is clearest on video). Hunk 2 opens; pause 2 s; accept.
- Run the Task A verification command.
- Say: "I select the function and give the instruction. The edit comes back as separate hunks, each with the agent's reason. I accept each one. The check prints False."
- Visible: streaming status, the diff, why line, hunk 1 of 2 and 2 of 2, `False`.

### S2 — Undo (10 s) · B2
- Do: click **Undo run** in the notification (or Command Palette → the ForgeTrail Undo run command; it reverts both hunks), then `git status`.
- Say: "Every applied change is undoable. The file is back to the original and git status is clean."
- Visible: the file restored, clean status.

### S3 — Task B: agent mode (90 s) · A2, B1, B2, B4
- Do: open the ForgeTrail panel. Mention no files. Paste the Task B instruction; click Run. **No cuts until the first diff appears.**
- While the agent works, let the context card and budget meter stay on screen at least 3 s (files chosen, reasons, tokens used out of the budget). Streaming text and the tool trail visible.
- Review the hunks one by one, pausing on the first hunk's why; accept all. Then run, in order: `git diff --stat` (at least 3 files), `pytest tests/test_cli.py -q` (passing), `flask --app <demo app> config` (secret-like keys show `***`, normal keys visible), `flask --help` (config listed).
- Say: "No files are named. The agent finds them itself under a token budget, and shows which files it chose and why. Each hunk is reviewed before anything is written. Tests pass and the new command masks secrets."
- Visible: context card, budget meter, why lines, four or more files in the diff stat, green pytest, masked JSON, `config` in help.

### S4 — TrueForge session (10 s) · Gate, B4
- Do: switch to the browser tab; open the Task B session; show turns, tool calls, the sub-agent count and the meta-tool calls; scroll once.
- Say: "This is the same run inside TrueForge: turns, tool calls, sub-agents and deferred tool loading."

### S5 — Task C: resilience (45 s) · B3
- Before recording: reset Flask to clean (`npm run reset:flask`). Start the clip with `git status` showing clean.
- Do: run `npm run setup -- --break-primary`; show the output (primary fails, fallback passes). Back in VS Code open `helpers.py`, select `get_debug_flag`, Ctrl+K Ctrl+E, paste the Task A instruction, Enter. **No cuts until the diff appears.**
- While waiting, click into an **Untitled** scratch editor and type a few characters (do not save it, so the repo stays untouched). This shows the editor stays responsive.
- The status bar shows the switch to the fallback model; a diff appears with no action from you. Reject the hunks. Run `git status`.
- Say: "The primary key is invalid. The editor stays responsive, the extension switches to the second model by itself, and nothing is written until I accept. I reject it, and git status shows no changes."
- Visible: failing primary, status bar switch message, typing in the scratch editor, diff from the fallback model, clean `git status`.
- After recording (off camera): `npm run setup -- --restore`.

### S6 — Cancel (25 s) · A3
- Start from a clean tree. In the panel, paste the Task B instruction and click Run; when text is streaming, click **Stop**. The panel shows the cancelled message with applied and discarded counts. Run `git status`.
- Say: "Stop works mid-generation. Nothing was written, and git status is clean."
- Visible: streaming, Stop, cancelled message, clean status.

### S7 — End card (8 s, optional)
- Text only: the project name, the repository URL, and the models (primary and fallbacks).

## 4. If a take goes wrong

- Reset (`npm run reset:flask`), restart the clip from its first step, and record again. Do not fix problems by cutting.
- Record two or three takes per clip and keep the best; keep the rejected ones until the submission is done.
- A model that misbehaves twice in a row is a quota or provider problem: check usage, then try later rather than burning more requests.

## 5. Scorecard timestamps (fill in right after the final cut; they go into the write-up)

| Criterion | Moment | Clip | Timestamp |
|---|---|---|---|
| A1 Inline edit | Diff with per-hunk accept/reject | S1 | 0:08–0:24 |
| A2 Agent mode | Three files changed (`cli.py`, `test_cli.py`, `cli.rst`), none named | S3 | 1:04–2:30 |
| A3 Streaming and cancel | Streaming text & tool trail; Stop mid-run with clean status | S1/S3, S6 | 1:16–1:44, 3:38–3:42 |
| B1 Context assembly | Context Chosen card with files, reasons and 12k token budget meter | S3 | 1:42–1:52 |
| B2 Diff safety | Per-hunk native diff review with why line; Undo Run restores the file | S1/S3, S2 | 0:18–0:24, 0:40–0:51 |
| B3 Resilience | `--break-primary`; automatic switch to fallback model; reject & clean status | S5 | 3:01–3:27 |
| B4 TrueForge depth | Session view with 8 turns, 30 tool calls, HITL approvals & deferred MCP tools | S4 | 2:45–2:58 |
| C1 Video | Verification on screen after each task (`verify:a`, `verify:b`, `verify:c`) | S0, S1, S3, S5 | 0:02, 0:34–0:39, 2:41–2:45, 3:22–3:27 |

## 6. After recording

1. Join the clips in order; no speed changes; export 1080p MP4; confirm the duration is **under 4:00**.
2. Upload (YouTube unlisted or Drive public link). Open the link in an incognito window and watch it to the end.
3. Fill the timestamps in `docs/writeup/WRITEUP.md` and `section6-scorecard.md`; put the video link in `README.md`. In the model section, declare the exact models and where each ran, since the primary is a "latest" alias that can change over time.
4. Export the write-up to PDF (1–3 pages, eight headings in order); open it from its public link.
5. Run `npm run check`; make sure the repo is public; submit the three links on the Techfest portal and keep a screenshot of the confirmation.
6. Tag `round1-submission` and push the tag.

Suggested schedule: one timed rehearsal tonight; record tomorrow morning; edit, upload, timestamps and PDF in the afternoon; submit tomorrow evening and keep 20 Nov as buffer.
