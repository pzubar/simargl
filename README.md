### 1. Configuration & Environment (`config/settings.py`)
- Centralizes all runtime settings: GCP project/region, API keys (YouTube, Gemini), local data paths (`channels.json`, registry JSON), polling/TTL values, ADK/Streamlit URLs.
- Loads `.env` so you can swap credentials without touching code; also sets `GOOGLE_APPLICATION_CREDENTIALS` so Vertex/Gemini SDKs see the service-account JSON.
- Defines defaults for Gemini models (standard + premium), File Search toggles, and Vertex Memory settings. Everything else imports these constants.

### 2. Data & Registry Layer (`channel_registry/…`)
- `ChannelRegistry` stores every tracked YouTube channel (aliases, handles, metadata snapshots, file-search store IDs, analyst notes) in `data/channel_registry.json`. It resolves ambiguous identifiers (URLs, @handles, owner names) to canonical channel IDs, deduplicates aliases, and persists updates to disk.
- `ChannelRefreshService` runs YouTube Data API calls to refresh snippet/statistics whenever the cached data expires or the analyst forces a refresh. After fetching, it updates the registry and emits a “channel fact” to the memory layer so downstream agents can recall the latest profile.

### 3. Memory & Knowledge Stores (`memory/…`)
- `ChannelMemoryService` is an optional wrapper around Vertex AI Memory Bank. If `VERTEX_MEMORY_AGENT_ENGINE_ID` plus project/region are present, it persists channel facts and can recall them per channel scope; otherwise it logs that memory is disabled.
- `FileSearchService` is a convenience layer on top of Gemini File Search (via `google.genai`). It can create stores, ingest transcripts/comments, and query them with grounding instructions. The agent’s tools use this service so every transcript/comment fetch can be remembered and re-used.

### 4. Tooling Layer (`tools/…`)
Each tool subclasses ADK’s `BaseTool`, exposes a Pydantic schema, and implements `run_async` so Gemini function calls invoke them. Highlights:
- **YouTube tools (`youtube_tool.py`):** 
  - `GetLatestVideosTool`, `SearchChannelVideosTool`, `GetVideoCommentsTool` share a cached `googleapiclient` client and wrap the YouTube Data API with quota-aware defaults.
- **Transcript tool (`transcript_tool.py`):** Fetches transcripts via `youtube-transcript-api` and optionally ingests them into File Search.
- **Analysis tools (`analysis_tool.py`):** Summarization and sentiment helpers built on Vertex/Gemini; they use distinct schemas (`SummarizeInput`, `SentimentInput`) and models (premium vs default).
- **File Search tools (`file_search_tool.py`):** Proxy user requests to create stores, upload text artifacts, and query stores.
- **Channel registry tool (`channel_registry_tool.py`):** Wraps `ChannelRefreshService` so Gemini can resolve/refresh channels before hitting expensive discovery endpoints.

All of these tools are registered with the orchestrator agent along with human-readable descriptions that steer Gemini’s function calling.

### 5. Orchestrator Agent (`agents/orchestrator.py`, `simargl_agent/agent.py`)
- `ORCHESTRATOR_SYSTEM_PROMPT` (lines 3–47) encodes the operating procedure: decompose user requests, honor quota costs, refresh metadata before discovery, prefer transcripts/comments, persist artifacts via File Search, and explain the plan.
- `simargl_agent/agent.py` assembles the ADK app: a single `LlmAgent` named `simargl_orchestrator` using the default Gemini model plus the tool list above. A global instruction reiterates the quota rule.
- `adk_server.py` exposes the agent through the ADK FastAPI server (`adk web` / `uvicorn`), allowing both the Streamlit UI and ADK Dev UI to talk to it.

### 6. Front-end & User Experience
- **Streamlit app (`app.py`):** Provides the analyst-facing UI—channel management sidebar (backed by the registry/refresh service) and a chat pane that posts queries to the ADK FastAPI endpoint. Responses are rendered as formatted JSON for debugging/testing.
- **ADK Dev UI:** Used during development to trace tool calls, inspect events, and debug Gemini errors. Launch with `adk web --port 8000 agents/…` while exporting `PYTHONPATH`, `ADK_APP_NAME`, and certificate envs.

### 7. Data Files & Defaults
- `channels.json`: a curated seed list of Ukrainian political/news channels (IDs, owners, handles). The Streamlit app can load it into the registry or let analysts add new channels manually.
- `data/channel_registry.json`: persisted registry state; created automatically if missing.
- Additional data/notes are embossed into this JSON plus File Search stores once transcription/comment tools run.

### 8. Dependencies (`requirements.txt`)
- Core: `google-adk`, `google-cloud-aiplatform`, `google.genai` via `google-adk` indirect dependency, `google-api-python-client`, Streamlit, Requests, Pandas, dotenv, `youtube-transcript-api`. These cover ADK runtimes, Gemini/File Search, YouTube APIs, and the UI.

### 9. Typical Request Flow
1. Analyst uses Streamlit (or ADK Dev UI) to send a question.
2. ADK FastAPI server forwards it to the `simargl_orchestrator` LLM.
3. The orchestration prompt decomposes the request, refreshes channel metadata (if needed), queries File Search, and only then calls expensive discovery tools (latest videos/search) or transcripts/comments.
4. Tool responses feed back into Gemini, which synthesizes the final answer and logs the plan.
5. If transcripts/comments were fetched, they’re ingested into File Search for future re-use; channel facts are stored in Vertex Memory (when enabled).
6. The Streamlit UI displays the JSON payload, while the Dev UI shows the event trace for debugging.

This layered design keeps Simargl modular: configuration/credentials are centralized, data/registry/memory services encapsulate persistence, tool modules abstract external APIs, and the ADK agent orchestrates everything based on quota-aware logic. You can run just the ADK backend (for integration with other clients) or the Streamlit UI for an analyst-friendly experience.

# Next Steps:

---

### 1. Vertex AI SDK deprecation warning
The log line comes from `vertexai.generative_models` (part of the `google-cloud-aiplatform` / Vertex AI SDK). Per Google’s migration guide, the entire Vertex AI SDK generative module is deprecated and will be removed after 24 June 2026; new projects should switch to the Google Gen AI SDK instead ([migration guide](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/deprecations/genai-vertexai-sdk)).

**What to do now:**
- Plan to replace `vertexai.*` imports (e.g., `vertexai.init`, `GenerativeModel`) with the `google.genai` equivalents. The new SDK exposes the same functionality with updated namespaces (`google.genai.Client`, `client.models.generate_content`, etc.).
- Because ADK itself still initializes Vertex AI models internally, keep an eye on upcoming ADK releases—they’ll migrate to Google Gen AI automatically. For your custom tools (e.g., `analysis_tool.py`), schedule time to refactor them to the new SDK before June 2026.

---

### 2. “Channel memory service disabled. Missing project or agent engine id.”
ADK tries to boot the Vertex AI Memory service but sees no Engine ID, so it logs that warning and skips memory. This is expected unless you’ve actually set up a memory bank. If you want Simargl to use memory:

1. **Provision a Vertex AI Memory Bank** (Agent Engine express mode). Follow Google’s setup guide: create an Agent Engine, enable Vertex AI in the target project, then note the reasoning-engine resource ID ([setup steps](https://docs.cloud.google.com/agent-builder/agent-engine/memory-bank/set-up#vertex-ai-express-mode)).
2. **Populate the required env vars** in `.env` or your shell before launching ADK:
   ```
   VERTEX_MEMORY_AGENT_ENGINE_ID=projects/<project>/locations/<region>/reasoningEngines/<engine-id>
   GCP_PROJECT_ID=<project>
   GCP_REGION=<region>            # e.g., us-central1
   GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
   ```
   The service account must have Vertex AI access (Generative AI User + Agent Builder roles).
3. Restart `adk web …`. The log will switch to “Channel memory service enabled…” once the engine ID is valid.

If you don’t plan to use memory, you can ignore the warning (or set `VERTEX_MEMORY_AGENT_ENGINE_ID=` explicitly and add a comment indicating memory is intentionally disabled).

---

Let me know when you’re ready to migrate the custom tools to `google.genai` or if you need help provisioning the memory engine—both are mostly configuration work but easy to script once the target project and service account are confirmed.
Next steps:
https://docs.cloud.google.com/agent-builder/agent-engine/memory-bank/set-up#vertex-ai-express-mode