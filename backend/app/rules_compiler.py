"""Turns a rule written in plain words into a change to the mandate.

With a Gemini key, an LLM proposes the change as structured JSON and code validates it.
Without one, a small pattern parser handles common phrasings (English and simple Hinglish).
The user always sees the compiled rule before it is saved.
"""
import re
from typing import Literal, Optional

from pydantic import BaseModel

from .config import settings
from .llm import gemini, with_retry
from .models import Mandate
from .guardian.rules import rs


class MandatePatch(BaseModel):
    budget: Optional[int] = None
    grocery_week: Optional[int] = None
    ask_above: Optional[int] = None
    seller_floor: Optional[float] = None
    price_tolerance: Optional[float] = None
    ask_addons: Optional[bool] = None
    ask_irreversible: Optional[bool] = None
    ask_off_task: Optional[bool] = None
    never_share_add: Optional[list[Literal["phone", "email", "address"]]] = None
    understood: bool = True
    summary: str = ""


SYSTEM = """Convert the user's shopping rule into changes to their agent's rule settings.
Fields: budget (total rupees for this sale), grocery_week (rupees per week on groceries),
ask_above (ask before any single order above this many rupees), seller_floor (lowest seller star rating, 0-5),
price_tolerance (fraction, ask if price is this much above its usual, e.g. 0.1 for 10%),
ask_addons, ask_irreversible, ask_off_task (true means ask first), never_share_add (phone, email, address).
Only set fields the rule talks about. Leave the rest null.
If the rule can't be expressed with these fields, set understood to false.
summary: the rule restated in one short plain sentence, starting with a verb, e.g. "Ask before any order over Rs 1,500"."""


async def compile_rule(text: str) -> dict:
    client = gemini()
    if client is not None:
        try:
            from google.genai import types
            resp = await with_retry(lambda: client.aio.models.generate_content(
                model=settings.rules_model, contents=text,
                config=types.GenerateContentConfig(system_instruction=SYSTEM, temperature=0,
                                                   response_mime_type="application/json",
                                                   response_schema=MandatePatch)), model=settings.rules_model)
            patch = resp.parsed if isinstance(getattr(resp, "parsed", None), MandatePatch) else MandatePatch.model_validate_json(resp.text)
            return {"patch": patch.model_dump(exclude_none=True), "by": "model"}
        except Exception:  # noqa: BLE001  fall back to the parser
            pass
    return {"patch": parse(text).model_dump(exclude_none=True), "by": "parser"}


def parse(t: str) -> MandatePatch:
    s = t.lower().replace(",", "").strip()
    num = re.search(r"(?:₹|rs\.?|inr)?\s*(\d{3,7})", s)
    n = int(num.group(1)) if num else None
    rating = re.search(r"(\d(?:\.\d)?)\s*(?:stars?|★|\+)", s) or re.search(r"\b([1-4]\.\d)\b", s)
    if re.search(r"star|rating|rated|★", s) and rating:
        v = float(rating.group(1))
        return MandatePatch(seller_floor=v, summary=f"Only buy from sellers rated {v}★ or higher")
    if re.search(r"(never|don'?t|do not|dont|mat) (share|bata|do)", s) or "never share" in s:
        fields = [f for f, rx in (("phone", r"phone|number|mobile"), ("email", r"e-?mail|mail"), ("address", r"address|pata"))
                  if re.search(rx, s)]
        if fields:
            return MandatePatch(never_share_add=fields, summary="Never share your " + _join(fields))
    if re.search(r"grocer|kirana|ration|rashan", s) and n:
        return MandatePatch(grocery_week=n, summary=f"Spend at most {rs(n)} a week on groceries")
    if re.search(r"ask|check|confirm|tell|puch", s) and re.search(r"over|above|more than|beyond|upar|zyada", s) and n:
        return MandatePatch(ask_above=n, summary=f"Ask before any order over {rs(n)}")
    if re.search(r"budget|total|spend|kharch", s) and n:
        return MandatePatch(budget=n, summary=f"Spend at most {rs(n)} this sale")
    if re.search(r"warrant|subscription|protection|add-?on|plan", s):
        return MandatePatch(ask_addons=True, summary="Ask before adding plans, warranties or subscriptions")
    if re.search(r"gift ?card|ticket|irreversible|non-?refundable|can'?t be cancel", s):
        return MandatePatch(ask_irreversible=True, summary="Ask before anything that can't be cancelled")
    pct = re.search(r"(\d{1,2})\s*%", s)
    if pct and re.search(r"price|typical|usual|above|more", s):
        return MandatePatch(price_tolerance=int(pct.group(1)) / 100,
                            summary=f"Ask if a price is more than {pct.group(1)}% above its usual price")
    return MandatePatch(understood=False, summary="")


def _join(a: list[str]) -> str:
    return a[0] if len(a) == 1 else ", ".join(a[:-1]) + " and " + a[-1]


def apply(m: Mandate, patch: dict) -> Mandate:
    data = m.model_dump()
    for k, v in patch.items():
        if k in ("understood", "summary"):
            continue
        if k == "never_share_add":
            data["never_share"] = sorted(set(data["never_share"]) | set(v))
        elif k in data:
            data[k] = v
    return Mandate.model_validate(data)