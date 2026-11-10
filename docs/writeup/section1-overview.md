# Section 1 — Executive Overview

ForgeTrail is an autonomous, model-independent VS Code pairing assistant designed for reliability, strict sandboxing, and full user inspectability. Built for the Techfest 2026-27 Forge-a-thon, the extension connects the editor to a local TrueForge agent loop via standard Model Context Protocol (MCP) Streamable HTTP interfaces.

Key highlights:
- **Zero Direct Model Invocations**: The extension host never makes direct LLM API calls; all turn coordination is delegated to a local TrueForge instance (`0.184.2`).
- **Interactive Approval Gating**: File modifications and shell commands pause at the MCP execution boundary. Edits are rendered in VS Code's native split diff editor with an inline rationale ("why" decoration) before disk apply.
- **Strict Retrieval Budget**: Context selection leverages regex symbol extraction and lexical relevance ranking, strictly constrained by a 12,000-token retrieval limit.
- **Fault-Tolerant Fallback**: Runtime failures (401 auth errors, 429 quota exhaustion, network timeouts) trigger client-side reruns with prompt hardening and automated model switching.
