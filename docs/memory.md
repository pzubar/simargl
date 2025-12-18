## Simargl Hybrid Memory

This release moves the agent from transient memory into a hybrid design:

- **Firestore (structured)** for `videos` and `channels` collections.
- **Gemini File Search (unstructured)** for transcripts/long-form content, referenced from Firestore via `rag_resource_name`.
- **Streamlit control plane** that uses the same services as the agent (no duplicate logic).

### Schemas

- `videos` documents (key: `video_id`):
  - `title`, `published_at`, `duration_sec`
  - `view_count`, `like_count`
  - `tags`, `custom_tags` (user/agent maintained)
  - `agent_summary`, `channel_id`, `rag_resource_name`
- `channels` documents (key: `channel_id`):
  - `channel_title`, `description`, `total_videos_indexed`, `last_indexed_at`

### Services (`memory/`)

- `VideoMetadataService`: Firestore CRUD + custom tag merge + cascade delete helper.
- `ChannelRegistryService` (Firestore): channel upserts and counters.
- `FileSearchService`: upload + `delete_document` for Gemini File Search.

### Tools (`tools/video_memory_tools.py`)

- `ingest_video_memory`: fetch YouTube metadata, upload transcript+description+title to File Search, then write Firestore records.
- `update_video_metadata`: atomic updates for stats, summary, and custom tags.
- `retrieve_videos`: filter by tag / min views and return enriched rows.

### UI

The Streamlit app (`app.py`) now exposes:
- Library grid (Title, Channel, Views, Tags, Custom Tags, Has Transcript) with tag filter.
- Manual ingest (YouTube URL/ID + File Search store).
- Metadata edits (custom tags, agent summary).
- Cascade delete (Firestore doc + File Search document).

### Terraform

New resources create Firestore (native) and a Discovery Engine data store for Gemini File Search. Defaults pull `project_id` from `.env` (`GCP_PROJECT_ID`) and `region=us-central1`.


