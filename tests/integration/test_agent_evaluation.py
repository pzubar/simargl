"""Pytest tests using ADK AgentEvaluator for integration testing."""

from __future__ import annotations

import pytest
from google.adk.evaluation.agent_evaluator import AgentEvaluator


@pytest.mark.asyncio
async def test_video_analysis_workflow_evalset():
    """Test video analysis workflow using evalset file."""
    await AgentEvaluator.evaluate(
        agent_module="simargl_agent",
        eval_dataset_file_path_or_dir="tests/evaluation/integration/video_analysis_workflow.evalset.json",
        config_file_path="tests/evaluation/test_config.json",
    )


@pytest.mark.asyncio
async def test_integration_evalset_with_config():
    """Test integration evalset with custom evaluation criteria."""
    await AgentEvaluator.evaluate(
        agent_module="simargl_agent",
        eval_dataset_file_path_or_dir="tests/evaluation/integration/video_analysis_workflow.evalset.json",
        config_file_path="tests/evaluation/test_config.json",
    )

