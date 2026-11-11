# Section 8 — Known Limitations

The following limitations are explicitly documented and backed by logged spike evidence:

1. **Free-Tier RPM & TPM Rate Quotas**:
   - Google AI Studio enforces 15 requests per minute (RPM) and 250,000 tokens per minute (TPM).
   - Rapid multi-turn MCP loops can trigger 429 errors without rate pacing. ForgeTrail mitigates this by enforcing `MIN_TOOL_INTERVAL_MS = 4500` (<= 13.3 RPM) in `src/mcp/server.ts`.
2. **TrueForge Standalone 20s Model Header Timeout**:
   - In TrueForge 0.184.2 local standalone mode, the HTTP client timeout for receiving initial response headers is fixed at 20 seconds. Heavy reasoning models (e.g. OpenAI o1 or deep thinking variants) can exceed this limit on large turns.
3. **NVIDIA NIM 404 Function Routes**:
   - Live developer keys from `build.nvidia.com` return HTTP 404 Function Not Found on general accounts.
4. **Single Active Run Concurrency**:
   - ForgeTrail deliberately locks the extension to one active run (`currentState !== 'idle'`) to prevent interleaved file modifications and state corruption.
5. **Regex Symbol Outline Scope**:
   - In-memory regex definition extractors support Python, TypeScript, and JavaScript. Other languages fall back to line-bracketed lexical chunks.
6. **Windows Local Sandbox Fallback**:
   - TrueForge's `LocalSandboxProvider` supports Linux and macOS container isolation; on Windows, commands execute in child processes gated by pathGuard and auto-allowlists.
