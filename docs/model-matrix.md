# Model Matrix & Provider Evaluation

This document tracks tested model candidates, free-tier quotas, tool-calling compatibility, response latencies, and fallback recommendations per `BUILD_api.md` (A-4) and `BUILD.md` (C3).

---

## 1. Evaluated Models

| Provider / Model | Stated Context Window | Free-Tier Quota | Plain Chat | Tool Calling (3/3) | Latency (avg) | Task A ($\times 3$) | Task B ($\times 2$) | Status & Notes |
|---|---|---|---|---|---|---|---|---|
| **`google-gemini/gemini-flash-lite-latest`** (or `gemini-3.5-flash-lite`) | 1,048,576 tokens | 15 RPM<br>250,000 TPM<br>500 RPD | PASS | PASS (3/3) | ~1.2s | **3/3 PASS** | **2/2 PASS** | **Primary Baseline.** Fast, reliable tool calls, handles CRLF normalization. Throttled at 4.5s in MCP to protect 15 RPM. |
| **`google-gemini/gemini-3-1-flash-lite`** | 1,048,576 tokens | 15 RPM<br>250,000 TPM<br>500 RPD | PASS | PASS (3/3) | ~1.4s | **3/3 PASS** | **1/2 PASS** | **Fallback Baseline.** Compatible tool calling, identical API interface. |
| **`nvidia/mistralai/mistral-large-2-instruct`** (NVIDIA NIM) | 128,000 tokens | 1000 credits trial | FAIL (404) | N/A | N/A | N/A | N/A | Returns 404 Function Not Found on NIM API account endpoints. |
| **`nvidia/meta/llama-3.2-90b-vision-instruct`** (NVIDIA NIM) | 131,072 tokens | 1000 credits trial | FAIL (404) | N/A | N/A | N/A | N/A | Returns 404 Function Not Found on NIM API account endpoints. |
| **`groq/llama-3.3-70b-versatile`** | 131,072 tokens | 30 RPM<br>6,000 TPM<br>14,400 RPD | PASS | PASS (3/3) | ~0.8s | **2/3 PASS** | Skipped | Secondary custom OpenAI-compatible provider. Fastest latency, low TPM ceiling. |

---

## 2. NVIDIA NIM 404 Error Body (Ground Truth)

As documented in `spike-results.md` and confirmed against live NVIDIA API keys:

```json
{
  "status": 404,
  "title": "Not Found",
  "detail": "Function '7fadd4de-e22a-48e4-90e9-f02ef14a74b9': Not found for account 'FQ6Znlhau6sRwR4JIQqJnhLEksvF3_crbBbQHaJK_Js'"
}
```
*Finding*: NVIDIA NIM keys generated from developer accounts fail across hosted function routes unless explicitly granted access to specific enterprise NIM cluster deployments.

---

## 3. Quota Limits & Rate Throttling Mitigations

### Google AI Studio Free Tier
- **Rate Limits**:
  - **15 RPM** (Requests Per Minute).
  - **250,000 TPM** (Input Tokens Per Minute).
  - **500 RPD** (Requests Per Day).
  - Documentation: [Google AI Studio Rate Limits](https://aistudio.google.com/docs/rate-limits).
- **ForgeTrail Mitigation**:
  - Implemented `MIN_TOOL_INTERVAL_MS = 4500` (4.5 seconds) in `src/mcp/server.ts`. This caps tool request bursts at $\le 13.3\text{ RPM}$, safely under the 15 RPM ceiling.
  - Implemented rolling 45s–60s quota resets in test runners (`test-task-b.ts`, `runWithFallback.ts`).

---

## 4. Fallback Recommendation

**Recommendation**: Use **`google-gemini/gemini-3-1-flash-lite`** (or a secondary Google AI Studio project key) as the automated fallback for Google Gemini, with Groq `llama-3.3-70b-versatile` as the OpenAI-compatible alternative.
- **Why**: Gemini 3.1 Flash-Lite exhibits identical tool schema parsing semantics, respects `read_file` line offsets, adheres to one-hunk-per-call constraints, and does not encounter OpenAPI serialization mismatches during multi-turn TrueForge sessions.

---

## 5. TrueForge Community Q&A

1. **(V5) Is the 20s model header timeout configurable?**
   - *Answer*: Currently fixed in TrueForge 0.184.2 standalone server; fast models (`flash-lite`) prevent timeouts, whereas deep thinking models can trigger it on complex multi-file turns.
2. **(V2) Does tool approval still gate a tool reached through deferred-loading meta-tools?**
   - *Answer*: Yes. Approval gating occurs at the MCP tool execution boundary regardless of whether schemas were preloaded or deferred.
3. **Is stdio MCP planned for local mode?**
   - *Answer*: Streamable HTTP and SSE are the supported transports for local MCP connectors in TrueForge 0.184.x; stdio is reserved for CLI plugins.
