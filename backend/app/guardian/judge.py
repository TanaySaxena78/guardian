"""LLM judge. It sees structured facts only, never raw page text, so page text can't inject it."""
import json
import logging
import re
from typing import Literal

from pydantic import BaseModel, Field

from ..config import settings
from ..llm import gemini, with_retry

log = logging.getLogger("guardian.judge")

SYSTEM = """You review one action that a personal shopping agent wants to take for its user.
You get only structured facts gathered by code, never text from web pages.

Decide:
- aligned_with_task: true only if the user's task asks for this item or action, or it is clearly needed to finish the task.
  Extra items, add-ons, larger quantities than needed, and sharing personal details are not aligned unless the task asks for them.
- verdict: "allow" if a careful person would let the agent go ahead, "ask" if the user should confirm first.
- risk: 0 to 1.
- reason: one short, plain sentence written to the user. No jargon.

Checks already flagged by code are listed. Don't repeat them in your reason."""


class JudgeOut(BaseModel):
    aligned_with_task: bool
    verdict: Literal["allow", "ask"]
    risk: float = Field(ge=0, le=1)
    reason: str


async def judge(task: str, facts: dict) -> dict | None:
    client = gemini()
    if client is None:
        return None
    from google.genai import types

    prompt = "User's task:\n" + task + "\n\nAction facts (JSON):\n" + json.dumps(facts, ensure_ascii=False, indent=1)
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM,
        temperature=0,
        response_mime_type="application/json",
        response_schema=JudgeOut,
    )
    try:
        resp = await with_retry(lambda: client.aio.models.generate_content(
            model=settings.judge_model, contents=prompt, config=config), model=settings.judge_model)
        parsed = getattr(resp, "parsed", None)
        if isinstance(parsed, JudgeOut):
            out = parsed
        else:
            out = JudgeOut.model_validate_json(resp.text)
        return out.model_dump() | {"model": settings.judge_model}
    except Exception as e:  # noqa: BLE001
        log.warning("Judge failed, falling back to rules only: %s", e)
        return {"error": str(e)[:200]}


# ---------- Offline fallback: is this item part of the task? ----------
_AMOUNT = re.compile(r"(?:₹|rs\.?|inr)\s*([\d,]{3,7})", re.I)


def keyword_in_task(task: str, p: dict) -> bool:
    t = task.lower()
    if p.get("is_addon"):
        return any(tag in t for tag in ("warranty", "protection", "subscription", "care+"))
    hit = any(tag in t for tag in p.get("tags", []))
    if not hit:
        return False
    if p["category"] == "giftcard":
        amounts = {int(a.replace(",", "")) for a in _AMOUNT.findall(task)}
        if amounts and p["price"] not in amounts:
            return False
    return True