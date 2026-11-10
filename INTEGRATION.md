# INTEGRATION.md — How the three parts join, and how we demo

> ⚠️ AGENT INSTRUCTIONS: This file defines how the three teammates' work connects. Follow it exactly. Do not invent integration points. If something is unclear: `// UNCLEAR: [question]`, log it in DECISIONS.md "Open questions", stop.

---

## 1. Dependency graph (what blocks what)

- **C-1 contracts (Core) → everything.** Nobody builds features until C-1 is merged (target: first hours of 10 Nov).
- **Core's own path is sequential:** C-2 MCP server → C-3 TrueForge client → C-4 propose_edit/apply/undo → C-5 modal → C-6 inline → C-8 (Task A). Then M2, then M3.
- **UI is independent until M1:** builds against the mock harness (U-2 step 1), then connects to Core's real `ReviewPresenter` calls.
- **API is independent:** A-1, A-2, A-3, A-5, A-6 need no extension code. A-5 plugs into Core at C-20 (M3).
- **Only two hard waits:** (1) UI waits for the contracts; (2) Core waits for the fallback policy (A-5) at C-20 and for the fallback model from A-4 at C-24.

## 2. Integration points

| # | Point | Provider | Consumer | Contract | First joint test | Date |
|---|---|---|---|---|---|---|
| I-1 | Contracts in code | Core | UI, API | BUILD.md C1–C11 | All three confirm "contracts read" | 10 Nov |
| I-2 | `computeProposedText`, `subscribe` exports | Core (stub in M0) | UI | BUILD_ui.md Imports | UI mock harness calls the stub | 10 Nov |
| I-3 | `ReviewPresenter` swap (modal → native) | UI | Core | C7 | Task A through the native diff | 12 Nov |
| I-4 | Setup script registers connectors and agents | API | Core | C1, C10 | Core runs `npm run setup`, sees PASS | 11 Nov |
| I-5 | `runWithFallback` around `executeRun` | API | Core | C9 | `--break-primary` run (C-20) | 13 Nov |
| I-6 | Fallback agent definitions | Core + API | Core | C10 | `smoke-fallback` PASS | 13 Nov |
| I-7 | Status bar / notifications from events | UI | Core events | C8 | Each string appears once | 13 Nov |
| I-8 | Verify and reset scripts | API | Core | BUILD_api.md A-6 | `verify:a` after a manual edit | 11 Nov |

## 3. Git and merge rules

- Branches: `core/<topic>`, `api/<topic>`, `ui/<topic>`. `main` always runs: Devesh merges, after the acceptance check of the task.
- Every commit that finishes a task includes its DECISIONS.md entry (BUILD.md R3). Commit message format: `<task id>: <what>` (e.g. `C-4: apply and undo`).
- `package.json` has one owner (Core). UI and API may add only their own entries (commands, keybindings, menus, npm scripts), each in a small separate commit; Devesh resolves conflicts.
- Nobody edits a file owned by someone else. If you need a change, post it in the team chat with the file and the exact change; the owner makes it.
- Stub rules: UI develops against `mockReview.ts`. API tests the fallback policy with fake `executeRun` functions. Neither waits for Core.
- Daily status: each person posts three lines in the team chat by 22:00 IST: done, doing next, blocked by.
- Pin versions: TrueForge 0.184.2 and SDK 0.184.1 everywhere. Never `@latest`.

## 4. Daily plan (10–15 Nov)

| Date | Core (Devesh) | API (Pranav) | UI (Vidyankshini) |
|---|---|---|---|
| Tue 10 Nov | **All three: SETUP.md Parts 1–3 first, send the Report block.** Then C-0, C-1, start C-2 | A-1, A-2, start A-3 | U-1, start U-2 step 1–2 |
| Wed 11 Nov | C-2…C-8 → **Task A passes ×3** | A-3 done, A-6, A-4 minimal | U-2 steps 3–5 |
| Thu 12 Nov | C-9…C-18, C-17 → **Task B 2/3**; swap presenter if U-2 done (I-3) | A-5, A-4 finish | U-2 steps 6–8, U-3 |
| Fri 13 Nov | C-19…C-24 → **Task C + cancel clip** | A-5 ready for C-20, A-9, README draft | U-4, U-5 |
| Sat 14 Nov | Dry runs ×3 of the full script (section 5), record video, C-26 | A-7 final, A-8 drafts | U-6, clean-clone test of README (A-7) |
| Sun 15 Nov | Scorecard timestamps, write-up sections 3/4/6/8, final tag | Assemble PDF, run `npm run check`, make repo public | Final video watch-through + link test |

Also on 11 Nov: **register the team on techfest.org** (registration closes 15 Nov; photo ID required; up to 5 members; each person only one team).

## 5. Demo path (the video — maximum 4:00)

Rules from the brief: Tasks A, B, C in that order; each followed by its on-screen verification; the TrueForge session shown briefly during Task B; model waiting time may be cut; **never cut between giving an instruction and the diff appearing**. Paste instructions instead of typing them. Reset before each take with `npm run reset:flask`.

| Time | What is on screen | Rubric criterion shown |
|---|---|---|
| 0:00–0:08 | Terminal: `git describe --tags` shows 3.1.3 in the Flask clone; editor opened | C1 |
| 0:08–0:55 | **Task A.** Select `get_debug_flag` in `src/flask/helpers.py`; press the keybinding; paste the exact instruction; diff appears with the why line; accept hunk 1, accept hunk 2; `npm run verify:a` prints `False` | A1, A3 (streaming text), B2, C1 |
| 0:55–1:05 | **Undo:** press Undo; the file returns to the original; `git status` clean | B2 |
| 1:05–2:35 | **Task B.** Open the panel; paste the exact Task B instruction; streaming text; context card with files, reasons and budget meter; review hunks one by one with reasons; accept all; `npm run verify:b` shows pytest passing, the masked JSON from `flask --app demo/app config`, and `config` in `flask --help` | A2, B1, B2, B4, C1 |
| 2:35–2:45 | Browser tab `http://localhost:8790/sessions`: the Task B session with turns, tool calls, sub-agent count and the meta-tool calls | Gate, B4 |
| 2:45–3:25 | **Task C.** Run `npm run setup -- --break-primary` (visible); repeat Task A; status bar shows the model switch; a diff from the fallback model appears with no user action; reject it; `npm run verify:c` shows workspace unchanged | B3, C1 |
| 3:25–3:50 | **Cancel clip:** start an agent run, press Stop while text streams; panel shows `Cancelled — N applied, M discarded`; `git status` clean | A3 |
| 3:50–4:00 | Buffer / end card | — |

Note: the Task B stretch from instruction to first diff includes retrieval and cannot be cut; if it runs long, keep the run short by rehearsing with the fastest model setup. Fill in the real timestamps after recording; they go into the write-up scorecard (section 6 of the PDF).

## 6. Recording checklist

- 1080p or higher; editor zoom chosen by UI (U-6); close unrelated tabs and notifications; Do Not Disturb on.
- Fresh `reset:flask`; `npm run trueforge` running; `npm run setup` all PASS; extension running (F5 window used for recording).
- Second browser tab pre-opened at the TrueForge sessions page.
- Primary model confirmed working before each take; keys for both models present.
- Upload to YouTube (unlisted) or Google Drive ("anyone with the link can view"); open the link in an incognito window to confirm it plays; paste the link into the submission portal and into the README.

## 7. Go/no-go gates and the cut list

Gates (end of day, IST): 11 Nov M1 (Task A ×3), 12 Nov M2 (Task B 2/3), 13 Nov M3 (Task C + cancel). If a gate is missed, cut in this order, one item at a time, until the gate can be passed next morning:

1. Anything already postponed (pending-hunks tree, CodeLens, autocomplete, PageRank, symbol providers, auto-start of TrueForge from the extension).
2. `@symbol` resolution simplified to the first definition only.
3. Panel extras: hunk list and "Undo run" button (keep Run, Stop, streaming, context card).
4. UI U-6 polish and U-5 extras.
5. API (Pranav) A-8 drafts (Devesh drafts the write-up himself) and the full model matrix (keep the minimal verified second model).
6. Native diff replaced by Core's modal presenter (expected loss about 3–5 points on A1/B2) — only if U-2 is not integrated by the end of 12 Nov.

**Never cut:** per-hunk review (modal or native), working undo, the cancel guard, client-side fallback with a visible switch, the context card with budget, the TrueForge session view, README with setup steps, the agent definitions in the repo, no keys committed, LICENSE, public links.

## 8. Submission checklist (by 15 Nov; hard deadline 20 Nov 23:59 IST)

- [ ] Team registered on techfest.org; team ID noted.
- [ ] GitHub repository public; README setup works from a clean clone (A-7 test done); MIT LICENSE present; `npm run check` all PASS; fork point statement "From scratch — no upstream project was forked."
- [ ] `agents/*.json` (the four definitions) committed; `config/models.example.json` and `.env.example` committed; no keys.
- [ ] Demo video ≤ 4:00, Tasks A, B, C in order with verification, TrueForge session shown in Task B; public link tested in incognito.
- [ ] Write-up PDF, 1–3 pages, eight headings in the exact order, scorecard with real timestamps, honest limitations; public link tested.
- [ ] Links pasted in the Techfest Competition Portal; confirm the portal shows them saved.
- [ ] DECISIONS.md complete: every finished module has an understanding note; call-prep section filled (DECISIONS.md Part 4).
- [ ] Final git tag `round1-submission`; do not push to `main` after submission except fixes to the README.
- [ ] Optional (independent of the technical score): social posts with #TrueForge #Forgeathon #<TeamName>, window 15 Oct – 18 Dec 2026.

Earlier submission wins ties (tie-breaks: B, then A, then earlier submission time).

## 9. Questions for the TrueForge Discord (API posts, answers go to DECISIONS.md)

1. Is the 20 s model header timeout configurable in local mode? (V5)
2. Does tool approval still gate a tool reached through the deferred-loading meta-tools? (V2)
3. Does the approval response support modifying the arguments in a later release, or is allow/deny the final design?
4. Is stdio MCP planned for local mode?

## 10. Risk register

| Risk | Impact | Mitigation | Owner |
|---|---|---|---|
| Free model makes wrong edits in Task B | A2/B1 lost | Escalating strict retries, fallback model, tuned prompts in M2 dry runs | Core |
| Only Gemini works as a provider | "any model" unproven | A-4 second provider; otherwise state limitation honestly | API |
| UI late | A1/B2 −3 to −5 | Modal presenter stays; gate on 12 Nov | UI / Core |
| 20 s timeout on slow thinking models (shortlist call) | Call fails | Ask Discord; keep fast model as default; `--primary` swap drill | API |
| Approval + deferred loading interaction (V2) | B4 loss | Two-connector design already isolates it; fallback in BUILD.md V2 | Core |
| Parallel approvals do not work (V1) | A2 slower | Sequential fallback documented | Core |
| Cancel lands mid-apply | A3 inconsistent | Atomic apply + cancelled-flag check (C-19) | Core |
| Endsem practicals from 16 Nov | Schedule | Everything frozen by 15 Nov | All |
| TrueForge pre-1.0 changes | Breakage | Pinned versions | All |

## 11. Point-risk audit (everything that could cost points if left untested)

| Rubric | Risk | Closed by | When |
|---|---|---|---|
| A1 Inline edit (10) | Native diff late, only the modal works (−3 to −5) | U-2 integrated by the 12 Nov gate | 12 Nov |
| A2 Agent mode (10) | Free model fails Task B or edits fewer than 3 files | C-17 passes 2 of 3 runs; strict retry; fallback model; model matrix Task B ×2 | 12 Nov |
| A3 Streaming + cancel (10) | Cancel is not part of the three fixed tasks, so it could go unseen | Cancel clip in the video + C-19 acceptance (a)–(e) | 13 Nov |
| B1 Context assembly (15) | Model ignores `CONTEXT:` lines; budget invisible | C-18 fallback using `suggest_context` reasons; budget meter in panel; strategy in write-up section 4 | 12 Nov |
| B2 Diff safety (10) | Undo never shown on screen | Undo moment at 0:55 of the video script | 14 Nov |
| B3 Resilience (10) | Only one provider verified | Second model or key from A-4; a second Gemini model or key still counts as a second configured model | 11–13 Nov |
| B4 TrueForge depth (10) | Deferred loading + approval untested (V2) | C-14 check with screenshot | 12 Nov |
| Gate | Session not shown, agent definitions missing, direct provider call | Video 2:35; `npm run check`; R10 | 15 Nov |
| C1 Video (10) | Over 4:00, cut between instruction and diff, outcome not legible | Three full rehearsals; recording checklist | 14 Nov |
| C2 Write-up (15) | Scorecard timestamps wrong; claims not backed | Fill after recording; every claim backed by a DECISIONS.md entry | 15 Nov |
| Shortlist call | Slow or unfamiliar model; a member cannot explain a module | `--primary` swap drill; understanding notes marked CHECKED by a teammate | before the call |
| Model independence | Works only with Gemini | BUILD.md C12, C-27, matrix Task A ×3 on 3 models, R11 check | 13 Nov |
