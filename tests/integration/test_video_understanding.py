"""Pytest tests for video understanding tools and workflows."""

from __future__ import annotations

import pytest
from google.adk.evaluation.agent_evaluator import AgentEvaluator


@pytest.mark.asyncio
async def test_get_video_details():
    """Test GetVideoDetailsTool via evaluation test file."""
    await AgentEvaluator.evaluate(
        agent_module="simargl_agent",
        eval_dataset_file_path_or_dir="tests/evaluation/unit/test_get_video_details.test.json",
    )


@pytest.mark.asyncio
async def test_analyze_video_short():
    """Test AnalyzeVideoTool with short video via evaluation test file."""
    await AgentEvaluator.evaluate(
        agent_module="simargl_agent",
        eval_dataset_file_path_or_dir="tests/evaluation/unit/test_analyze_video_short.test.json",
    )


@pytest.mark.asyncio
async def test_analyze_video_chunking():
    """Test AnalyzeVideoTool chunking logic via evaluation test file."""
    await AgentEvaluator.evaluate(
        agent_module="simargl_agent",
        eval_dataset_file_path_or_dir="tests/evaluation/unit/test_analyze_video_chunking.test.json",
    )


@pytest.mark.asyncio
async def test_video_workflow_two_step():
    """Test complete two-step video workflow via evaluation test file."""
    await AgentEvaluator.evaluate(
        agent_module="simargl_agent",
        eval_dataset_file_path_or_dir="tests/evaluation/unit/test_video_workflow_two_step.test.json",
    )


@pytest.mark.asyncio
async def test_all_unit_tests():
    """Run all unit tests in the evaluation/unit directory."""
    await AgentEvaluator.evaluate(
        agent_module="simargl_agent",
        eval_dataset_file_path_or_dir="tests/evaluation/unit/",
    )

