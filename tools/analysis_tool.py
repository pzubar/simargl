"""Vertex AI-powered analysis tools for summarization and sentiment."""

from __future__ import annotations

import logging
from typing import Any, Dict

import vertexai
from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from pydantic import BaseModel, Field
from vertexai.generative_models import GenerativeModel, Part

from config.settings import (
    DEFAULT_GEMINI_MODEL,
    GCP_PROJECT_ID,
    GCP_REGION,
    GEMINI_MODEL_PREMIUM,
)

logger = logging.getLogger(__name__)

# Initialize Vertex AI once at import.
vertexai.init(project=GCP_PROJECT_ID, location=GCP_REGION)
_SUMMARY_MODEL = GenerativeModel(GEMINI_MODEL_PREMIUM)
_SENTIMENT_MODEL = GenerativeModel(DEFAULT_GEMINI_MODEL)


class SummarizeInput(BaseModel):
    text_content: str = Field(..., description="The text to be analyzed.")


class SentimentInput(BaseModel):
    text_content: str = Field(..., description="The text whose sentiment should be classified.")


class SummarizeTool(BaseTool):
    """Tool to summarize a block of text using Gemini."""

    NAME = "summarize_text"
    DESCRIPTION = "Summarizes a long piece of text (like a transcript or comments)."

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )

    @property
    def args_schema(self) -> type[SummarizeInput]:
        return SummarizeInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return self(text_content=args["text_content"])

    def __call__(self, text_content: str) -> Dict[str, Any]:
        try:
            response = _SUMMARY_MODEL.generate_content(
                Part.from_text(
                    "Summarize the following text in 3-5 concise bullet points highlighting key themes:\n\n"
                    f"{text_content}"
                )
            )
            summary_text = response.text if hasattr(response, "text") else str(response)
            return {"summary": summary_text}
        except Exception as exc:  # noqa: BLE001
            logger.exception("Error summarizing text")
            return {"error": f"Error summarizing text: {exc}"}


class SentimentAnalysisTool(BaseTool):
    """Tool to analyze the sentiment of a block of text."""

    NAME = "get_sentiment"
    DESCRIPTION = (
        "Analyzes sentiment of text (e.g., a list of comments) and returns "
        "Positive, Negative, or Neutral."
    )

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )

    @property
    def args_schema(self) -> type[SentimentInput]:
        return SentimentInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return self(text_content=args["text_content"])

    def __call__(self, text_content: str) -> Dict[str, Any]:
        try:
            response = _SENTIMENT_MODEL.generate_content(
                Part.from_text(
                    "Analyze the sentiment of the following text. "
                    "Respond with only one of Positive, Negative, or Neutral.\n\n"
                    f"{text_content}"
                )
            )
            sentiment_text = response.text.strip() if hasattr(response, "text") else str(response).strip()
            return {"sentiment": sentiment_text}
        except Exception as exc:  # noqa: BLE001
            logger.exception("Error performing sentiment analysis")
            return {"error": f"Error performing sentiment analysis: {exc}"}


__all__ = ("SummarizeTool", "SentimentAnalysisTool")


