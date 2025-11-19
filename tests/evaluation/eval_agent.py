"""Evaluation script for Simargl Agent."""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd
import vertexai
from vertexai.preview.evaluation import EvalTask, MetricPromptTemplateExamples, PointwiseMetric
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# Ensure we can import from the project root
project_root = Path(__file__).resolve().parent.parent.parent
if str(project_root) in sys.path:
    sys.path.remove(str(project_root))
sys.path.insert(0, str(project_root))

from simargl_agent.agent import root_agent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def parse_adk_output(events: list) -> Dict[str, Any]:
    """Parses ADK events to extract response and tool calls."""
    final_response = ""
    trajectory = []

    for event in events:
        if not getattr(event, "content", None) or not getattr(event.content, "parts", None):
            continue
        for part in event.content.parts:
            if getattr(part, "function_call", None):
                info = {
                    "tool_name": part.function_call.name,
                    "tool_input": dict(part.function_call.args),
                }
                trajectory.append(info)
            if event.content.role == "model" and getattr(part, "text", None):
                final_response += part.text

    return {"response": final_response, "trajectory": trajectory}

async def run_agent(query: str) -> Dict[str, Any]:
    """Runs the Simargl Supervisor agent."""
    import inspect
    print(f"DEBUG: sys.path: {sys.path}")
    print(f"DEBUG: root_agent defined in: {inspect.getfile(root_agent.__class__)}")
    print(f"DEBUG: root_agent instance: {root_agent}")
    print(f"DEBUG: Agent Tools: {[t.name for t in root_agent.tools]}")
    session_service = InMemorySessionService()
    session = session_service.create_session_sync(user_id="eval_user", app_name="simargl_eval")
    
    runner = Runner(agent=root_agent, session_service=session_service, app_name="simargl_eval")
    
    message = types.Content(
        role="user", parts=[types.Part.from_text(text=query)]
    )
    
    events = []
    # Using run() sync wrapper if run_async is not easily available or behaves differently in this env
    # But ideally we use run_async. The notebook used run_async.
    # Let's try run_async as in the notebook.
    async for event in runner.run_async(
        new_message=message,
        user_id="eval_user",
        session_id=session.id,
    ):
        events.append(event)
        
    return parse_adk_output(events)

def evaluate_tool_use(predicted_trajectory: List[Dict], expected_tools: List[str]) -> float:
    """Custom metric: Checks if expected tools were called."""
    if not expected_tools:
        return 1.0
    
    called_tools = [t["tool_name"] for t in predicted_trajectory]
    
    # Check if all expected tools are present
    missing = [t for t in expected_tools if t not in called_tools]
    if missing:
        return 0.0
    
    return 1.0

async def main():
    # Load Golden Dataset
    dataset_path = Path(__file__).parent / "golden_dataset.json"
    with open(dataset_path, "r") as f:
        dataset = json.load(f)
    
    results = []
    
    print(f"Running evaluation on {len(dataset)} examples...")
    
    for example in dataset:
        query = example["input_text"]
        print(f"Processing: {query}")
        
        agent_output = await run_agent(query)
        
        response = agent_output["response"]
        trajectory = agent_output["trajectory"]
        
        # Custom Tool Use Metric
        tool_score = evaluate_tool_use(trajectory, example.get("expected_tool_calls", []))
        
        print(f"Response: {response}")
        print(f"Trajectory: {trajectory}")
        print(f"Tool Score: {tool_score}")
        print("-" * 40)
        
        results.append({
            "prompt": query,
            "response": response,
            "ground_truth": example.get("ground_truth", ""),
            "predicted_trajectory": [t["tool_name"] for t in trajectory],
            "expected_trajectory": example.get("expected_tool_calls", []),
            "tool_use_accuracy": tool_score
        })

    df = pd.DataFrame(results)
    
    # Initialize Vertex AI for LLM-based metrics
    # Note: This requires authentication and project setup.
    try:
        project_id = os.environ.get("GOOGLE_CLOUD_PROJECT")
        location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
        
        if project_id:
            vertexai.init(project=project_id, location=location)
            
            # Define Metrics
            faithfulness = PointwiseMetric(
                metric="faithfulness",
                metric_prompt_template=MetricPromptTemplateExamples.get_prompt_template(
                    "faithfulness"
                ),
            )
            
            answer_relevance = PointwiseMetric(
                metric="answer_relevance",
                metric_prompt_template=MetricPromptTemplateExamples.get_prompt_template(
                    "answer_relevance"
                ),
            )
            
            eval_task = EvalTask(
                dataset=df,
                metrics=[faithfulness, answer_relevance],
                experiment="simargl-eval"
            )
            
            eval_result = eval_task.evaluate()
            print("\nEvaluation Results:")
            print(eval_result.summary_metrics)
            
            # Check acceptance criteria
            if eval_result.summary_metrics.get("faithfulness/mean", 0) > 0.8:
                print("PASSED: Faithfulness > 0.8")
            else:
                print("WARNING: Faithfulness <= 0.8")
                
        else:
            print("Skipping Vertex AI evaluation (no project ID).")
            
    except Exception as e:
        print(f"Vertex AI evaluation failed: {e}")
        print("Falling back to basic reporting.")

    # Basic Report
    print("\nDetailed Results:")
    print(df[["prompt", "predicted_trajectory", "tool_use_accuracy"]])
    
    avg_tool_accuracy = df["tool_use_accuracy"].mean()
    print(f"\nAverage Tool Use Accuracy: {avg_tool_accuracy}")

if __name__ == "__main__":
    asyncio.run(main())
