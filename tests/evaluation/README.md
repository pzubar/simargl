# Simargl Agent Evaluation Tests

This directory contains automated evaluation tests for the Simargl YouTube research assistant agent using Google's Agent Development Kit (ADK) evaluation framework.

## Overview

The evaluation tests are organized into two categories:

1. **Unit Tests** (`unit/`): Fast, simple tests for individual tool behaviors and basic agent interactions
2. **Integration Tests** (`integration/`): Complex, multi-turn conversations testing the full agent workflow

## Test Structure

### Unit Tests

Unit tests are stored as `.test.json` files in `tests/evaluation/unit/`:

- `test_get_video_details.test.json` - Tests video details retrieval
- `test_analyze_video_short.test.json` - Tests video analysis for short videos (< 1 hour)
- `test_analyze_video_chunking.test.json` - Tests chunking logic for long videos
- `test_video_workflow_two_step.test.json` - Tests complete two-step workflow

### Integration Tests

Integration tests are stored as `.evalset.json` files in `tests/evaluation/integration/`:

- `video_analysis_workflow.evalset.json` - Full workflow with multiple scenarios including error handling

### Test Configuration

The `test_config.json` file specifies evaluation criteria:

- `tool_trajectory_avg_score`: 1.0 (exact match required for tool calls)
- `response_match_score`: 0.8 (allows some variation in natural language responses)

## Running Tests

### Via Command Line Interface (CLI)

**Important:** Since this project uses `uv` for dependency management, you must run `adk eval` through `uv run` to ensure the eval dependencies are available:

#### Run a single test file:
```bash
uv run adk eval simargl_agent tests/evaluation/unit/test_get_video_details.test.json
```

#### Run an evalset file:
```bash
uv run adk eval simargl_agent tests/evaluation/integration/video_analysis_workflow.evalset.json --config_file_path=tests/evaluation/test_config.json
```

#### Run all tests in a directory:
```bash
uv run adk eval simargl_agent tests/evaluation/unit/
```

#### Run with detailed output:
```bash
uv run adk eval simargl_agent tests/evaluation/unit/test_get_video_details.test.json --config_file_path=tests/evaluation/test_config.json --print_detailed_results
```

**Note:** If you get an error about the eval module not being installed, make sure you've installed the eval dependencies:
```bash
uv pip install "google-adk[eval]"
```

### Via Pytest

#### Run individual test files:
```bash
# Run video understanding unit tests
pytest tests/integration/test_video_understanding.py -v

# Run agent evaluation integration tests
pytest tests/integration/test_agent_evaluation.py -v
```

#### Run all integration tests:
```bash
pytest tests/integration/ -v
```

#### Run specific test:
```bash
pytest tests/integration/test_video_understanding.py::test_get_video_details -v
```

### Via Web UI

1. Start the ADK web server:
   ```bash
   adk web simargl_agent
   ```

2. Navigate to the **Eval** tab in the web interface

3. Create new eval cases or run existing ones interactively

4. Use the UI to:
   - Create and edit test cases
   - Run evaluations with custom metrics
   - Analyze results with side-by-side comparisons
   - Debug using the Trace view

## Test Scenarios

### Scenario 1: Get Video Details
- **Input:** YouTube video URL or ID
- **Expected Trajectory:** `["get_video_details"]`
- **Expected Response:** Contains `duration_seconds`, `video_id`, `title`

### Scenario 2: Analyze Short Video (< 1 hour)
- **Input:** Video URL + duration
- **Expected Trajectory:** `["analyze_video"]` (single chunk)
- **Expected Response:** Contains transcript and analysis with visual descriptions, emotions, sentiment

### Scenario 3: Analyze Long Video (> 1 hour)
- **Input:** Video URL + duration > 3500 seconds
- **Expected Trajectory:** `["analyze_video"]` (with chunking)
- **Expected Response:** Combined transcript and analysis from multiple chunks

### Scenario 4: Complete Two-Step Workflow
- **Input:** "Analyze this video: [YouTube URL]"
- **Expected Trajectory:** `["get_video_details", "analyze_video"]`
- **Expected Response:** Complete analysis with all artifacts

### Scenario 5: Error Handling
- **Input:** Invalid video URL or non-existent video ID
- **Expected Behavior:** Graceful error handling with informative messages

## Evaluation Criteria

### Tool Trajectory Score (`tool_trajectory_avg_score`)
- **Threshold:** 1.0 (exact match required)
- **Purpose:** Validates that the agent calls tools in the expected order with correct arguments
- **Use Case:** Regression testing, CI/CD pipelines

### Response Match Score (`response_match_score`)
- **Threshold:** 0.8 (allows variation)
- **Purpose:** Measures similarity between actual and expected responses using ROUGE-1
- **Use Case:** Validates natural language response quality

### Additional Criteria (Available but not configured by default)

- `final_response_match_v2`: LLM-judged semantic match (more flexible than exact matching)
- `rubric_based_final_response_quality_v1`: Custom rubrics for response quality
- `rubric_based_tool_use_quality_v1`: Custom rubrics for tool usage quality
- `hallucinations_v1`: Checks if responses are grounded in context
- `safety_v1`: Validates response safety and harmlessness

## Interpreting Results

### Pass/Fail Status

Tests pass when:
- Tool trajectory matches exactly (score = 1.0)
- Response match score meets threshold (≥ 0.8)

Tests fail when:
- Tool calls don't match expected trajectory
- Response similarity is below threshold
- Agent encounters errors that aren't handled gracefully

### Detailed Results

When using `--print_detailed_results`, you'll see:
- Actual vs. expected tool calls
- Response comparison scores
- Detailed breakdown of evaluation metrics

### Debugging Failed Tests

1. **Check Tool Trajectory**: Verify that tools were called in the correct order with correct arguments
2. **Review Response Content**: Compare actual vs. expected responses to identify differences
3. **Use Trace View**: In the web UI, use the Trace tab to inspect agent execution flow
4. **Check Logs**: Review agent logs for errors or unexpected behavior

## Adding New Tests

### Creating a Unit Test

1. Create a new `.test.json` file in `tests/evaluation/unit/`
2. Follow the ADK EvalSet schema:
   ```json
   {
     "eval_set_id": "unique_test_id",
     "name": "Test Name",
     "description": "Test description",
     "eval_cases": [
       {
         "eval_id": "case_id",
         "conversation": [
           {
             "invocation_id": "unique_invocation_id",
             "user_content": {
               "parts": [{"text": "User query"}],
               "role": "user"
             },
             "final_response": {
               "parts": [{"text": "Expected response"}],
               "role": "model"
             },
             "intermediate_data": {
               "tool_uses": [
                 {
                   "name": "tool_name",
                   "args": {"arg": "value"}
                 }
               ],
               "intermediate_responses": []
             }
           }
         ],
        "session_input": {
          "app_name": "simargl_agent",
           "user_id": "test_user",
           "state": {}
         }
       }
     ]
   }
   ```

### Creating an Integration Test

1. Create a new `.evalset.json` file in `tests/evaluation/integration/`
2. Follow the same schema but include multiple `eval_cases` for complex scenarios
3. Each `eval_case` can have multiple conversation turns

### Adding Pytest Test

Add a new test function to `tests/integration/test_video_understanding.py` or `test_agent_evaluation.py`:

```python
@pytest.mark.asyncio
async def test_my_new_scenario():
    """Test description."""
    await AgentEvaluator.evaluate(
        agent_module="simargl_agent",
        eval_dataset_file_path_or_dir="tests/evaluation/unit/test_my_new_scenario.test.json",
    )
```

## CI/CD Integration

These tests can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run Agent Evaluation Tests
  run: |
    uv run pytest tests/integration/test_video_understanding.py -v
    uv run pytest tests/integration/test_agent_evaluation.py -v
    uv run adk eval simargl_agent tests/evaluation/unit/ --config_file_path=tests/evaluation/test_config.json
```

Or using the CLI directly:

```bash
uv run adk eval simargl_agent tests/evaluation/unit/ --config_file_path=tests/evaluation/test_config.json
```

## Best Practices

1. **Use Realistic Test Data**: Use actual YouTube video IDs for realistic testing
2. **Keep Tests Focused**: Each test should verify one specific behavior
3. **Update Expected Responses**: When agent behavior changes, update expected responses accordingly
4. **Document Test Purpose**: Include clear descriptions explaining what each test validates
5. **Regular Maintenance**: Review and update tests as the agent evolves

## Troubleshooting

### Common Issues

1. **Import Errors**: Ensure `simargl_agent` module is in Python path
2. **API Key Issues**: Verify `GEMINI_API_KEY` and `YOUTUBE_API_KEY` are set
3. **Video Not Found**: Some test videos may become unavailable; update video IDs as needed
4. **Timeout Errors**: Long videos may timeout; adjust timeout settings if needed

### Getting Help

- Check ADK documentation: https://ai.google.dev/adk/docs
- Review test logs for detailed error messages
- Use the web UI Trace view for debugging

