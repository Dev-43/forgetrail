# 7. Tools Used

In accordance with rule R4 and competition guidelines, all software tools, runtime environments, and AI coding assistants used in the conception, development, and testing of ForgeTrail are honestly disclosed below:

### 1. Developer Environment & Runtimes
- **IDE:** Visual Studio Code (Extension Development Host engine `^1.93.0`).
- **Runtime:** Node.js v22.17.1 on Windows 11 (PowerShell 5.1 / 7).
- **Language / Tooling:** TypeScript 5.7.3 (`strict: true`), compiled with native `tsc` without third-party bundlers.
- **Script Execution:** `tsx` (TypeScript Execute) for zero-compilation script execution.
- **Test Harnesses:** `node:test` built-in test runner for pure logic unit testing; Python 3.12 virtual environments with `pytest` for Flask 3.1.3 baseline verification.

### 2. Core Agent Framework & Libraries
- **TrueForge Daemon:** `@truefoundry/trueforge` pinned at version `0.184.2` running in local standalone mode.
- **TrueForge Client SDK:** `@truefoundry/trueforge-sdk` pinned at `0.184.1`.
- **Model Context Protocol:** `@modelcontextprotocol/sdk` (Streamable HTTP transport) for bidirectional tool serving.

### 3. AI Coding Assistants (Full Disclosure)
- **Claude (Anthropic)**: Utilized during initial project inception (M0) for architectural scoping, requirements mapping, and contracts formalization in `DECISIONS.md` (`D-001`).
- **Antigravity (Google DeepMind)**: Primary autonomous and pair-programming AI coding assistant utilized across Milestones M0, M1, M2, M3, and M4 for codebase implementation, MCP tool integration, native diff review wiring, resilience policies, and automated verification suites.
  - Every single AI execution turn, instructions received, files touched, and UNCLEAR checkpoints were logged in real-time in [DECISIONS.md](../../DECISIONS.md) Part 5 ("Agent log").
