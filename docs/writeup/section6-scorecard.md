# Section 6 — Scorecard with Timestamps

### Benchmark Runs on Flask 3.1.3 (`dev/forge-spike/flask`)

| Milestone / Task | Run / Iteration | Wall Time | Touched Files | Verification Status | Clean Undo Status | Evidence / Log File |
|---|---|---|---|---|---|---|
| **M1: Task A** | Iteration 1 | 42.1s | 1 file (`helpers.py`) | PASS (`get_debug_flag()` = False) | PASS (`verify:c` clean) | `task-1520.log` |
| **M1: Task A** | Iteration 2 | 38.6s | 1 file (`helpers.py`) | PASS (`get_debug_flag()` = False) | PASS (`verify:c` clean) | `task-1520.log` |
| **M1: Task A** | Iteration 3 | 41.2s | 1 file (`helpers.py`) | PASS (`get_debug_flag()` = False) | PASS (`verify:c` clean) | `task-1520.log` |
| **M2: Task B** | Run 1 (task-1863) | 362.4s | 3 files (`cli.py`, `test_cli.py`, `cli.rst`) | PASS (all 4 criteria) | PASS (reverted 5 hunks) | `task-1863.log` |
| **M2: Task B** | Run 2 (task-2611) | 274.3s | 4 files (`cli.py`, `test_cli.py`, `cli.rst`, `api.rst`) | PASS (all 4 criteria) | PASS (reverted 5 hunks) | `task-2611.log` |
| **M3: Task C** | Case 1 (`--break-primary`) | ~8.4s | 0 files | PASS (switched to fallback, clean on rejection) | PASS (`verify:c` clean) | `test-task-c.ts` |
| **M3: Task C** | Case 2 (`--no-fallback`) | ~3.2s | 0 files | PASS (clean error within 10s) | PASS (`verify:c` clean) | `test-task-c.ts` |
| **M3: Cancel** | Cancel mid-stream | < 100ms | 0 files | PASS (process killed, tabs closed) | PASS (`verify:c` clean) | `test-cancel.ts` |

All acceptance criteria met across repeated consecutive benchmark runs.
