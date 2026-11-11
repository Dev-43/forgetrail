# 2. Starting Point

**From scratch — no upstream project was forked.**

ForgeTrail was conceived, architected, and built entirely from an empty git repository initialized for the Techfest 2026-27 Forge-a-thon. 

- **No Upstream Templates or Boilerplate Forks**: The VS Code extension skeleton was created directly using standard VS Code Extension APIs with strict TypeScript compilation (`tsconfig.json`).
- **No Third-Party Diff Libraries**: All diff rendering utilizes the VS Code native diff editor (`vscode.diff`) and virtual text documents (`forgetrail-proposed://`), avoiding external diff dependencies or custom webview diff clones.
- **Zero Copied Code**: All components—including the Streamable HTTP MCP server, the lexical context retrieval engine, the regex-based symbol extractors, and the atomic hunk undo stack—were authored from first principles in compliance with project rule R5.
