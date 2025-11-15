# Project Overview

This project, Simargl, is a monorepo containing a NestJS API application. The API handles video analysis, content processing, and quota management. It integrates with various services and uses MongoDB for data storage.

## Key Areas:

*   **API (`apps/api`):** Core application with controllers, services, schemas, and task processors.
*   **Admin Panel (`apps/api/src/admin`):** Frontend components for administrative tasks.
*   **Tasks (`apps/api/src/tasks`):** Background processors for various operations like video analysis, channel polling, and content processing.
*   **Schemas (`apps/api/src/schemas`):** Mongoose schemas defining the data models.
*   **Services (`apps/api/src/services`):** Business logic and integrations.

## Technologies Used:

*   **Backend:** NestJS, TypeScript, Adminjs
*   **Database:** MongoDB
*   **Task Queue:** BullMQ (implied by processor files in `apps/api/src/tasks`)
*   **Frontend (Admin):** React (implied by `.jsx` files)
*   **Docker** See `docker-compose.dev.yml` for containerization during development

## Common Development Tasks:

*   Adding new API endpoints.
*   Implementing new background tasks.
*   Modifying database schemas.
*   Extending the admin panel functionality.

## Gemini API Usage:

This project leverages the Gemini API primarily through the `VideoAnalysisService` (`apps/api/src/services/video-analysis.service.ts`). The main use case is to combine analyses of video chunks using the Gemini Pro model. The API key for Gemini is configured via the `GEMINI_API_KEY` environment variable.

### Key Services Involved:

*   **`VideoAnalysisService`**: Initializes the `GoogleGenAI` client with the `GEMINI_API_KEY` and makes `generateContentStream` calls to the Gemini API. It constructs prompts for combining video chunk analyses and handles responses.
*   **`EnhancedQuotaManagerService`**: Manages the quota for various Gemini models (e.g., `gemini-2.5-pro`, `gemini-2.5-flash`). It selects the most suitable model based on estimated token usage and available quotas (RPM, TPM, RPD). This service also handles temporary overload situations for models.

### Workflow for Gemini API Calls:

1.  **Prompt Construction**: The `VideoAnalysisService` constructs a detailed prompt using existing chunk analyses and video information.
2.  **Model Selection**: The `EnhancedQuotaManagerService` determines the best available Gemini model based on estimated token count and current quota limits.
3.  **API Call**: The `VideoAnalysisService` then calls the Gemini API's `generateContentStream` method with the selected model and constructed prompt.
4.  **Response Handling**: The service processes the streamed response from the Gemini API to obtain the combined video analysis.

This `GEMINI.md` file serves as a high-level overview to help Gemini understand the project structure and context for more effective interactions. 