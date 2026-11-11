# Section 3 — Architecture on TrueForge

```mermaid
graph TD
    subgraph VS Code Extension Host
        UI[Native Diff Editor & Status Bar]
        Panel[Agent Webview Panel]
        RC[RunController State Machine]
        MCP[Local MCP Server :3333]
        Undo[Atomic Apply & UndoStore]
    end

    subgraph TrueForge Local Daemon :8790
        Engine[Agent Turn Orchestrator]
        Catalogs[Model Providers & Connectors]
        DB[(forge.sqlite)]
    end

    subgraph Model Providers
        Primary[Google Gemini / Primary Model]
        Secondary[Groq / Secondary Model]
    end

    Panel -->|instruction| RC
    UI -->|accept / reject| RC
    RC -->|sessions.createTurnStream| Engine
    Engine -->|mcp-session-id Streamable HTTP| MCP
    MCP -->|pathGuard, 12k budget| RC
    Engine -->|LLM calls| Primary
    Engine -.->|fallback failover| Secondary
    RC -->|WorkspaceEdit snapshot| Undo
```

### Architectural Principles
1. **Isolated CommonJS/ESM Bridge**: The VS Code Extension Host (CommonJS) bridges with `@truefoundry/trueforge-sdk` through dynamic ESM imports, eliminating packaging conflicts.
2. **Streamable HTTP Session Multiplexing**: MCP endpoints `/mcp-core` and `/mcp-extra` on port 3333 maintain session state keyed on `mcp-session-id`, preventing "Server already initialized" conflicts across multi-turn agent runs.
3. **Approval-Driven Review**: Proposed edits trigger TrueForge `tool.approval_required` events, pausing the loop server-side while the user reviews the diff.
