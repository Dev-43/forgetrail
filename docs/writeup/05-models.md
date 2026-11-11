# 5. Model Setup

### Models used

All models are configured in TrueForge (catalog provider or OpenAI-compatible endpoint) by `npm run setup` from `config/models.json`; the extension never calls a provider.

| Role (agent) | Model | Where it runs | Cost |
|---|---|---|---|
| Primary, inline + agent mode (`forgetrail-*-primary`) | `google-gemini/gemini-3-6-flash` | Google AI Studio, free tier | $0.00 |
| Inline fallback (`forgetrail-inline-fallback`) | `qwen/qwen3.8-27b` | Groq, OpenAI-compatible endpoint, free tier | $0.00 |
| Agent-mode fallback (`forgetrail-agent-fallback`) | `mistralai/mistral-large-4-1t-a52b` | NVIDIA build.nvidia.com, OpenAI-compatible endpoint, free credits | $0.00 |
| Used during development | `google-gemini/gemini-3-1-flash-lite` | Google AI Studio, free tier | $0.00 |

Model probe on 2026-11-11 (plain reply + one `read_file` tool call through TrueForge): `gemini-3-5-flash-lite`, `gemini-3-5-flash`, `gemini-3-6-flash` and `gemini-flash-lite-latest` passed in 2–10 s; `gemini-3-7-flash` hit TrueForge's 20 s header timeout; `gemini-3-8-flash` returned 503 (high demand); `gemini-3-1-flash-lite`, `gemini-flash-latest` and `gemini-3-1-pro-preview` returned 429 (free-tier quota). On Groq, `llama-3.3-70b-versatile` is no longer offered and `openai/gpt-oss-120b` fails in TrueForge on multi-turn requests (`reasoning_content` rejected), so `qwen/qwen3.8-27b` is used.

*Total inference cost across build and testing: $0.00 (free tiers only).*

### How a user switches models

1. Put the provider's key in `.env` (any variable name).
2. In `config/models.json`, add or edit an entry in `providers` (`builtin` for a TrueForge catalog provider; `openai-compatible` with `baseUrl` and the model ids otherwise) and point `models.primary` / `models.fallback` / `models.agentFallback` at `<provider>/<model id>`.
3. Run `npm run setup` (or, without editing the file, `npm run setup -- --primary <provider>/<model id>`). Setup registers the providers, creates the four agents and prints `PASS smoke-primary` / `PASS smoke-fallback` when both models answer.
