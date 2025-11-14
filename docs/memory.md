## Simargl Memory & Retrieval Overview

This project now layers three complementary memory systems so agents can answer research questions without repeatedly spending YouTube quota.

### 1. Channel Registry (JSON today, BigQuery-ready)

- Stored at `config.settings.CHANNEL_REGISTRY_PATH` (`data/channel_registry.json` by default).
- Each `ChannelRecord` tracks canonical identifiers (channel ID, custom URL, handle), owner metadata, analyst notes, Gemini File Search store references, and the latest YouTube statistics snapshot.
- Natural language inputs such as `https://www.youtube.com/@STERNENKO`, `@sternenko`, or `Serhii Sternenko` resolve to the same entry via the registry’s alias matching.
- `ChannelRefreshService` (see `channel_registry/refresh_service.py`) refreshes snippet/statistics via `youtube.channels().list`, updates the registry, and writes a concise fact into the Vertex AI Memory Bank for long-term recall.

### 2. Vertex AI Memory Bank (Lightweight facts)

- Managed through `memory/channel_memory_service.py`, backed by ADK’s `VertexAiMemoryBankService`.
- Each channel is mapped to a dedicated `user_id` namespace (`channel:{channel_id}`) so agents can `remember` or `recall` persona facts, qualitative notes, and metadata summaries without rebuilding context.
- Configuration lives in `.env` via `VERTEX_MEMORY_AGENT_ENGINE_ID`. When enabled, any refreshed channel metadata is summarized and persisted automatically.

### 3. Gemini File Search (RAG-scale artifacts)

- High-volume artifacts (transcripts, aggregated comments, analyst dossiers) are uploaded to Gemini File Search stores.
- `tools/transcript_tool.py` and `tools/youtube_tool.py` automatically persist transcripts/comments whenever a `file_search_store_name` is provided.
- `tools/file_search_tool.py` exposes ADK tools to create stores, ingest documents, and query grounded snippets. The orchestrator prompt now prefers querying File Search before scheduling new API calls.
- Refer to the official docs for cost profile and API usage: [Gemini File Search](https://ai.google.dev/gemini-api/docs/file-search).

### Agent Workflow Updates

1. **Resolve channel identifiers:** call `refresh_channel_metadata` to populate registry entries and reuse cached stats/notes.
2. **Reuse stored context:** query existing File Search stores before fetching new transcripts or comments.
3. **Persist new findings:** pass `file_search_store_name` parameters when calling transcript/comment tools so ingestion happens automatically, and rely on the channel memory service for qualitative summaries.

This layered approach keeps API usage “surgical”, satisfies the YouTube quota constraint in `requiriments.md`, and aligns with the ADK guidance on Sessions, State, and Memory.


