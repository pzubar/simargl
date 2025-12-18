# Simargl: YouTube Research Assistant

Simargl is an intelligent agent system designed to discover, analyze, and track YouTube content. It uses a multi-agent architecture to handle complex research tasks, from finding new videos to performing deep-dive analysis and tracking longitudinal trends.

## Setup and Running

### 1) Install dependencies

```bash
uv pip install -r requirements.txt
```

### 2) Run the agent (ADK web UI)

```bash
export PYTHONPATH=$PYTHONPATH:.
adk web simargl_agent
```

### 3) Run the Streamlit control plane (manual ingest/CRUD UI)

```bash
# Required env: GCP_PROJECT_ID, YOUTUBE_API_KEY, optional GCP_REGION (default us-central1)
export PYTHONPATH=$PYTHONPATH:.
uv run streamlit run app.py --server.port 8501
```

The Streamlit UI reuses the same services/tools as the agent; use it to ingest videos, edit custom tags/summaries, and cascade delete (Firestore + File Search).

## Provision Firestore + Gemini File Search with Terraform

The repo includes Terraform to create:
- Firestore (native, `(default)` database) in your `region`
- Discovery Engine data store for Gemini File Search
- Required APIs (firestore, discoveryengine, genai, etc.)

### Quickstart (dev stack)
```bash
cd deployment/terraform/dev
terraform init
terraform apply \
  -var="dev_project_id=${GCP_PROJECT_ID}" \
  -var="region=${GCP_REGION:-us-central1}"
```

Notes:
- Ensure `gcloud auth application-default login` (or set `GOOGLE_APPLICATION_CREDENTIALS`) before running.
- The dev stack provisions Firestore `(default)` and a data store named `${var.project_name}-file-search` (`project_name` defaults to `simargl`).
- For staging/prod, use `deployment/terraform` with `prod_project_id` and `staging_project_id` variables.

## Architecture Overview

Simargl operates as a hierarchical multi-agent system, orchestrated by a **Supervisor Agent**.

### Core Agents

1.  **Supervisor Agent (`simargl_supervisor`)**:
    *   **Role**: The main entry point. It receives user requests and routes them to the appropriate specialized sub-agent.
    *   **Logic**: It distinguishes between discovery (finding content), analysis (deep dives), and historical/trend questions.

2.  **Discovery Agent ("Scout")**:
    *   **Role**: Finds videos and channel metadata.
    *   **Tools**: Uses YouTube Data API to search for videos, get latest uploads, and retrieve channel details.

3.  **Analyst Agent ("Researcher")**:
    *   **Role**: Performs deep analysis on specific videos.
    *   **Tools**: Can fetch transcripts, summarize content, analyze sentiment, and extract key insights.

4.  **Historian Agent**:
    *   **Role**: Analyzes trends over time and compares data points (e.g., "How has the discourse changed since last year?").
    *   **Workflow**: It has a built-in **Critique Loop**. Its outputs are automatically verified by a Critique Agent to ensure accuracy and relevance before being returned to the user.

### Data & Infrastructure

*   **Channel Registry**: A persistent store (`data/channel_registry.json`) that tracks known channels, aliases, and metadata. It ensures the agent uses canonical IDs.
*   **Memory Layer**:
    *   **Vertex AI Memory**: Stores "channel facts" for long-term recall (if configured).
    *   **File Search**: Ingests transcripts and comments into a searchable knowledge base for grounding.

## Typical Request Flow

1.  **User Request**: The user sends a query via the ADK Web UI (e.g., "What are the latest videos about the election?").
2.  **Routing**: The **Supervisor Agent** analyzes the intent and delegates the task.
    *   *Example*: "Latest videos" -> **Discovery Agent**.
3.  **Execution**: The sub-agent executes its specific tools.
    *   The **Discovery Agent** might call `search_channel_videos` or `get_latest_videos`.
    *   The **Analyst Agent** might call `get_transcript` and then `summarize_video`.
4.  **Verification (Historian only)**: If the **Historian Agent** is used, its draft response is checked by a Critique Agent. If rejected, it retries with feedback.
5.  **Response**: The final result is returned to the Supervisor, which presents it to the user.

## Configuration

*   **`config/settings.py`**: Central configuration for API keys, project settings, and defaults.
*   **`.env`**: Environment variables for credentials (API keys, project IDs).
