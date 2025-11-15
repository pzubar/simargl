"""Vertex AI-powered analysis tools for summarization and sentiment."""

from __future__ import annotations

import logging
from typing import Any, Dict

from google import genai
from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from pydantic import BaseModel, Field

from config.settings import (
    DEFAULT_GEMINI_MODEL,
    GEMINI_MODEL_PREMIUM,
)

logger = logging.getLogger(__name__)
client = genai.Client()

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
            response = client.models.generate_content(
              model=_SUMMARY_MODEL,
              contents= "Summarize the following text in 3-5 concise bullet points highlighting key themes:\n\n" f"{text_content}",
#               config=types.GenerateContentConfig(
#                 temperature=0.3,
#                 response_logprobs=True,
#                 logprobs=3,
#               ),
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
            contents = "Analyze the sentiment of the following text. Respond with only one of Positive, Negative, or Neutral.\n\n" f"{text_content}"
            response = client.models.generate_content(
              model=_SENTIMENT_MODEL,
              contents= contents,
            )
            sentiment_text = response.text.strip() if hasattr(response, "text") else str(response).strip()
            return {"sentiment": sentiment_text}
        except Exception as exc:  # noqa: BLE001
            logger.exception("Error performing sentiment analysis")
            return {"error": f"Error performing sentiment analysis: {exc}"}


__all__ = ("SummarizeTool", "SentimentAnalysisTool")


