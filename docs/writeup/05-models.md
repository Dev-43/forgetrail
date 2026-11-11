# 5. Model Setup

### Models Used & Evaluation Matrix

| Role | Provider & Model Identifier | Hosting / Infrastructure | Cost | Rate Limits & Quotas | Observed Behavior |
|---|---|---|---|---|---|
| **Primary Model** | `google-gemini/gemini-2.5-flash` (or `gemini-flash-lite-latest`) | Google AI Studio cloud endpoints | Free Tier ($0.00) | 15 RPM, 250k TPM, 500 RPD | Fast turn latency (< 3s), reliable multi-file hunk formatting, respects tool calling schemas. |
| **Fallback Model** | `google-gemini/gemini-2.0-flash` (via secondary backup key) | Google AI Studio cloud endpoints | Free Tier ($0.00) | 15 RPM, 250k TPM, 500 RPD | Immediate failover target when primary key hits 429 quota exhaustion or 401 auth failure. |
| **Candidate Provider** | `nvidia/meta/llama-3.1-70b-instruct` | NVIDIA NIM Developer Cloud | Free Tier ($0.00) | 5000 credits | `GET /v1/models` returns HTTP 200, but developer tier returns HTTP 404 Function Not Found on completion routes. |

*Total LLM inference expenditure during entire build, test, and verification phases: **$0.00**.*

---

### The 60-Second Model Swap Procedure

Per architectural rule R11, ForgeTrail contains **zero model names or provider strings** inside `src/`. Switching models is completely configuration-driven:

1. **Add Key to `.env`**:
   ```env
   NEW_PROVIDER_API_KEY=your_key_here
   ```
2. **Register Provider in `config/models.json`**:
   Add the provider catalog configuration with endpoint URL and model identifiers.
3. **Execute Setup CLI**:
   ```bash
   npm run setup -- --primary provider-name/model-name
   ```
4. **Verification**:
   `setup.ts` automatically contacts TrueForge, registers the provider, upserts the primary agent definition, and runs `smoke-primary`. Once `PASS smoke-primary` appears, the model is fully active.
