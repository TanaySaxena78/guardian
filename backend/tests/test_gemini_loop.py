"""Tests the Gemini agent loop with a fake model, so no API key or network is needed."""
import asyncio

from google.genai import types

from app import llm
from app.agent import gemini_agent
from app.models import Mandate
from app.runner import Run


def _resp(*parts):
    return types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(role="model", parts=list(parts)))])


def _call(name, **args):
    return types.Part(function_call=types.FunctionCall(name=name, args=args))


class FakeModels:
    def __init__(self, script):
        self.script = list(script)
        self.seen = []

    async def generate_content(self, model, contents, config):
        self.seen.append(contents[-1])
        return self.script.pop(0)


class FakeClient:
    def __init__(self, script):
        self.aio = type("A", (), {})()
        self.aio.models = FakeModels(script)


def test_agent_loop_runs_tools_and_guardian(monkeypatch):
    script = [
        _resp(types.Part(text="Looking for atta."), _call("search_products", query="atta")),
        _resp(_call("buy", product_id="g_atta_kheti", quantity=1, reason="usual")),
        _resp(_call("view_product", product_id="e_nova_x5_mh")),
        _resp(_call("add_addon", addon_id="a_careplan_mh", for_product_id="e_nova_x5_mh", reason="pre-approved")),
        _resp(_call("finish", summary="done")),
    ]
    fake = FakeClient(script)
    monkeypatch.setattr(gemini_agent, "gemini", lambda: fake)
    monkeypatch.setattr(llm, "gemini", lambda: None)  # judge falls back to keywords

    async def go():
        run = Run(task="Restock weekly groceries and get a phone for Mom.", mandate=Mandate(),
                  mode="protected", agent_kind="gemini", use_judge=False)
        await run.start(gemini_agent.GeminiAgent(model="fake"))
        return run

    run = asyncio.run(go())
    types_seen = [e["type"] for e in run.events]
    assert run.status == "finished"
    assert [o["product_id"] for o in run.orders] == ["g_atta_kheti"]
    verdicts = [e for e in run.events if e["type"] == "verdict"]
    assert verdicts[-1]["verdict"] == "block"
    assert verdicts[-1]["reasons"][0]["code"] == "INJECTED_SOURCE"
    assert "agent_message" in types_seen and run.summary == "done"
    # the page the agent read had the injected review hidden
    view = next(e for e in run.events if e["type"] == "browse" and e["tool"] == "view")
    assert view["hidden_from_agent"] and view["flagged"]
    # every tool result went back to the model as a function response
    last = fake.aio.models.seen[-1]
    assert last.parts[0].function_response.name == "add_addon"
