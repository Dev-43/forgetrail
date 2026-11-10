# Section 4 — How Context is Selected

ForgeTrail uses a budgeted lexical retrieval pipeline rather than heavy native embeddings or vector stores:

### 1. The 12,000-Token Budget (`RUN_RETRIEVAL_MAX_TOKENS`)
Every retrieval tool (`read_file`, `search_workspace`, `repo_outline`, `suggest_context`) computes an estimated token size (`ceil(chars / 4)`). Every read deducts from the 12,000-token budget. If exhausted, further reads return `E_BUDGET`, forcing the agent to proceed with accumulated context.

### 2. Outline Extraction (`repo_outline`)
Extracts class, function, and method signatures using regex definitions across Python, TypeScript, and JavaScript. Outlines are scored by keyword hits and bounded to 1,500 tokens (`OUTLINE_MAX_TOKENS`).

### 3. Relevance Ranking (`suggest_context`)
Analyzes user instructions, extracts search keywords, and ranks candidate files across three categories:
- Source implementation files (`src/`, `flask/`)
- Test suites (`tests/`)
- Documentation files (`docs/`)
Ranks up to 8 candidate files (`SUGGEST_MAX_FILES`) with explicit reasons and token sizes.

### 4. Explicit Mentions (`@file:` and `@symbol:`)
Users can attach explicit context directly into prompts:
- `@file:<path>` extracts up to 200 lines, appending outline summaries if truncated.
- `@symbol:<name>` resolves symbol definition blocks with line coordinates.
Both inject blocks under `ATTACHED CONTEXT` and display in the panel's "Context Chosen" card.
