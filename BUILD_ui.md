# BUILD_ui.md — UI teammate (Vidyankshini): review experience and editor feedback

> ⚠️ AGENT INSTRUCTIONS: You are building ONLY the items in this file. Nothing else. Build exactly as specified. Read BUILD.md section 0 (rules) and section 5 (contracts C6, C7, C8, C11) first. If anything is unclear: `// UNCLEAR: [question]`, log it in DECISIONS.md "Open questions", stop that task.

## Your Scope

Everything the user sees in the editor around the review of edits: the native diff review of one hunk at a time with Accept and Reject, the "why" shown on each hunk, the inline-edit keybinding and menu, the status bar, the notifications and the undo buttons, closing everything cleanly on cancel. Rubric points you carry: A1 (10, per-hunk accept/reject in the editor) and B2 (10, per-hunk review and undo on screen), 20 points in total. You work 2–3 hours a day; order is by points.

## Your Files

`src/review/ui/proposedDocProvider.ts`, `reviewController.ts`, `whyDecoration.ts`, `mockReview.ts`, `src/ui/statusBar.ts`, `src/ui/notifications.ts`, and small additions to `package.json` under the rule in INTEGRATION.md section 3.

## Imports you may use from Core (do not reimplement them)

- `computeProposedText(currentText, request)` exported from `src/apply/applyEdit.ts` (Core publishes a working stub in M0).
- `subscribe(listener)` exported from `src/trueforge/runController.ts` delivering C8 events.
- Commands registered by Core: `forgetrail.undoLast`, `forgetrail.undoRun`, `forgetrail.inlineEdit`, `forgetrail.openPanel`.
- The `ReviewPresenter` interface and `ReviewRequest`/`ReviewDecision` types from `src/shared/contracts.ts`.

## Priority order

U-2 (days 1–3), U-4, U-3, U-5, U-6. If U-2 is not integrated by the end of 12 Nov, Core's modal presenter stays and the cut list in INTEGRATION.md section 7 applies (expected loss: about 3–5 points on A1/B2 — so protect U-2).

---

### U-1 Study note (M0) — ~1 h
- What: read the VS Code API docs for `TextDocumentContentProvider`, the `vscode.diff` command, `editor/title` menu contributions and `TextEditorDecorationType`. You may read other open-source extensions for ideas but do NOT copy code (BUILD.md R5). Write a 10-line understanding note for "Review UI" in DECISIONS.md, in your own words.
- Acceptance: the note exists and answers: how a virtual document is served; how a diff editor is opened; how a title-bar button is bound to a command; how a decoration shows text after a line.

### U-2 Native diff review (M0–M1) — ~6 h
Do it in this order:
1. **Mock harness first.** `src/review/ui/mockReview.ts` registers the command `ForgeTrail: Mock review`, which takes the active file and presents three fake `ReviewRequest`s in sequence: two `replace` hunks in that file and one `create` of a new file, with realistic reasons and sources. You can build and test everything below without Core or TrueForge.
2. **Proposed document.** `proposedDocProvider.ts` serves the virtual scheme `forgetrail-proposed` (and an empty `forgetrail-empty` for `create`). The content for a hunk is `computeProposedText(currentText, request)` where `currentText` is the open document's text if open, else the file on disk.
3. **Open the diff.** `reviewController.ts` implements `ReviewPresenter.present(request)`: opens `vscode.diff` with left = the real file (or the empty doc for `create`), right = the proposed document, title `ForgeTrail [<index>/<total>] <path>`, in the main editor area, and reveals the hunk's line range on the right side. The promise resolves only when the user decides.
4. **Accept and Reject.** Commands `forgetrail.review.accept` and `forgetrail.review.reject`, shown as buttons in the `editor/title` menu when `resourceScheme == forgetrail-proposed` (primary UX) and bound to `ctrl+alt+y` / `ctrl+alt+n` (macOS `cmd+alt+y` / `cmd+alt+n`) with the same `when`. Reject opens an input box "Why? (optional — sent to the agent)"; Escape means no feedback. Result is a `ReviewDecision`.
5. **The why.** `whyDecoration.ts` shows, after the first changed line on the right side, muted text `◀ why: <reason> (from <sources joined by ", ">)`; readable in both a dark and a light theme.
6. **Staleness.** At accept time compare `document.version` with `request.baseVersion`; if different, do not accept: show the string S_STALE_SKIP and return `reject` with feedback equal to the D_STALE text in BUILD.md C6.
7. **Queue behaviour.** Closing the diff tab does NOT decide. The status bar item (U-4) stays and reopens the pending hunk when clicked (command `forgetrail.review.show`). Hunks are presented one at a time; after a decision the next opens automatically.
8. **dispose(runId).** Closes every diff tab and virtual document of that run and clears decorations; safe to call twice.
- Files: `src/review/ui/*`.
- Acceptance (with the mock harness, then through Core after M1): three hunks appear one by one with the why visible; Accept resolves `accept`, Reject with text resolves `reject` with that feedback; editing the file between present and accept produces the stale skip; closing the tab and clicking the status bar reopens it; `dispose` closes everything; the editor stays responsive (typing in another file works) while a review is open.

### U-3 Inline-edit entry point (M1) — ~1.5 h
- What: in `package.json` add the command contribution `forgetrail.inlineEdit` (title "ForgeTrail: Inline Edit"), a keybinding `ctrl+alt+e` (macOS `cmd+alt+e`) with `when: editorHasSelection`, and an editor context-menu entry with the same `when`. Check in the Keyboard Shortcuts editor that the binding has no default conflict; if it does, change it and log it. While a run is active (event `run.started` kind `inline`), highlight the selected range with a light background decoration; remove it on `run.finished`, `run.cancelled` or `run.error`.
- Acceptance: the shortcut and the menu entry start Core's command; the highlight appears and disappears correctly in all three end states.

### U-4 Status bar, notifications, undo buttons (M2) — ~2 h
- What: `statusBar.ts` shows one item reflecting the latest C8 event; `notifications.ts` shows the messages. Strings (use exactly):

| Code | Text |
|---|---|
| S_SELECT | `Select code first.` |
| S_RUNNING | `ForgeTrail: running (<model>)` |
| S_REVIEW | `ForgeTrail: review <n> pending` (clicking runs `forgetrail.review.show`) |
| S_SWITCHED | `ForgeTrail: <from> failed, switched to <to>` (stays until the run ends) |
| S_NO_FALLBACK | `ForgeTrail: the model could not be reached. Nothing was changed. Check your model settings.` |
| S_CANCELLED | `ForgeTrail: cancelled — <applied> applied, <discarded> discarded` |
| S_APPLIED | `ForgeTrail: applied <n> hunk(s)` with buttons `Undo last` and `Undo run` |
| S_UNDO_DONE | `ForgeTrail: undone <path>` |
| S_UNDO_BLOCKED | `ForgeTrail: cannot undo <path> because it changed since.` |
| S_BUSY | `ForgeTrail: a run is already active.` |
| S_STALE_SKIP | `ForgeTrail: skipped a hunk because <path> changed.` |

  `Undo last` calls `forgetrail.undoLast`, `Undo run` calls `forgetrail.undoRun`; the notifications for undo results come from the result values those commands return.
- Acceptance: each string appears at the right moment when the corresponding event is triggered (use Core's events or a small temporary emitter); no string is invented or reworded.

### U-5 Cancel and end-of-run cleanup (M3) — ~1 h
- What: on `run.cancelled`, `run.finished` and `run.error`, make sure `dispose(runId)` effects are visible: no stray diff tabs, no decorations, the status bar returns to idle after 3 seconds (except S_SWITCHED, which persists until the run ends, and S_NO_FALLBACK, which persists for 10 seconds).
- Acceptance: after a cancel during an open review the screen has no leftover review UI; repeat 5 times without a leak (check `forgetrail-proposed` documents are gone from open editors).

### U-6 Recording polish (M4, last) — ~1.5 h
- What: make the video legible: diff titles short, why text readable at the recording zoom, no overlapping notifications, review buttons visible at 1080p with the editor zoom set to the recording value. Write the layout you settled on into `docs/recording-checklist.md` (editor zoom, panel position, theme) for Devesh.
- Acceptance: one full Task A review recorded at 1080p is readable on a phone screen.

---

## Contracts You Must Honor

BUILD.md C6 (message strings), C7 (`ReviewRequest`, `ReviewDecision`, `ReviewPresenter`), C8 (events), C11 (states). If a field you need is missing, ask Devesh — do not add it yourself.

## DO NOT

- Do not add a pending-hunks tree, CodeLens, an agent panel, autocomplete, themes or any feature not listed (the panel belongs to Core; the tree is on the cut list and needs Devesh's approval).
- Do not edit files you do not own (`src/shared/*`, `src/apply/*`, `src/mcp/*`, `src/trueforge/*`, `src/panel/*`, `scripts/*`, `agents/*`).
- Do not write to the user's workspace files yourself; accepting only returns a `ReviewDecision`, Core applies the edit.
- Do not reword the strings in the table above.
- Do not copy code from other extensions.
- Do not change any `package.json` entry except the ones you add, and keep each edit in its own small commit.
