"""Finds instructions hidden in listings, reviews and seller chats.

Two layers:
1. Pattern rules (fast, offline, explainable).
2. Llama Prompt Guard 2 hosted on Groq (multilingual classifier), when GROQ_API_KEY is set.
A text is flagged if either layer flags it.
"""
import asyncio
import hashlib
import logging
import re

import httpx

from ..config import settings
from ..llm import limiter

log = logging.getLogger("guardian.scanner")

PATTERNS = [
    (r"ignore (all |any |the )?(previous|prior|above|earlier) (instructions|rules|prompts?)", 3, "Tries to override the agent's instructions"),
    (r"\b(note|message|instruction)s? (to|for) (the )?(ai|assistant|agent|bot|shopping assistant)s?\b", 3, "Speaks to AI agents directly"),
    (r"\b(ai |shopping )?(agents?|assistants?|bots?)\s*:", 3, "Addresses AI agents directly"),
    (r"\b(system|developer|admin) (note|message|prompt|override)\s*:", 3, "Pretends to be a system message"),
    (r"\b(pre-?approved|already approved|has approved)\b", 2, "Claims the user already approved something"),
    (r"\bshare (the |your )?(user'?s?|customer'?s?|buyer'?s?|owner'?s?) (phone|mobile|number|email|address|otp)", 3, "Asks for the user's personal details"),
    (r"\b(ai|assistants?|agents?|bots?)\b[^.]{0,40}\b(add|buy|order|share|apply|purchase|kar(o|do)?)\b", 2, "Gives orders to an agent"),
    (r"\b(agent|assistant|ai)\s+(ko|se)\b", 1, "Instruction to an agent in Hinglish"),
    (r"\b(otp|one[- ]time password|upi pin)\b", 2, "Mentions an OTP or UPI PIN"),
]
_COMPILED = [(re.compile(p, re.I), w, label) for p, w, label in PATTERNS]
THRESHOLD = 3

_cache: dict[str, float | None] = {}
_sem = asyncio.Semaphore(4)


def heuristic(text: str) -> dict:
    score, hits = 0, []
    for rx, w, label in _COMPILED:
        if rx.search(text or ""):
            score += w
            hits.append(label)
    return {"score": score, "hits": hits, "flagged": score >= THRESHOLD}


def _parse_score(content: str) -> float | None:
    """Groq's Prompt Guard returns text. Accept a 0-1 score or a label."""
    s = (content or "").strip()
    try:
        v = float(s)
        if 0.0 <= v <= 1.0:
            return v
    except ValueError:
        pass
    up = s.upper()
    if any(k in up for k in ("MALICIOUS", "INJECTION", "JAILBREAK", "UNSAFE")):
        return 1.0
    if "BENIGN" in up or up == "SAFE":
        return 0.0
    m = re.search(r"\b(0?\.\d+|1(?:\.0+)?|0)\b", s)
    return float(m.group(1)) if m else None


async def prompt_guard(text: str) -> float | None:
    """Probability that text is an injection, from Prompt Guard 2. None if unavailable."""
    if not settings.has_groq or not text.strip():
        return None
    key = hashlib.sha256(text.encode()).hexdigest()
    if key in _cache:
        return _cache[key]
    score = None
    async with _sem:
        for attempt in range(4):
            await limiter("groq", settings.groq_rpm).wait()
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    r = await client.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                        json={"model": settings.prompt_guard_model,
                              "messages": [{"role": "user", "content": text[:2000]}]},
                    )
                if r.status_code == 429 and attempt < 3:
                    await asyncio.sleep(float(r.headers.get("retry-after", 2 ** (attempt + 1))) + 0.5)
                    continue
                r.raise_for_status()
                content = r.json()["choices"][0]["message"]["content"]
                score = _parse_score(content)
                if score is None:
                    log.warning("Unrecognised Prompt Guard output: %r", content[:80])
                break
            except Exception as e:  # noqa: BLE001
                log.warning("Prompt Guard call failed: %s", e)
                break
    if score is not None:
        _cache[key] = score  # don't cache failures, so a later call can retry
    return score


async def scan(text: str, use_model: bool = True) -> dict:
    h = heuristic(text)
    model = await prompt_guard(text) if use_model else None
    model_flag = model is not None and model >= settings.prompt_guard_threshold
    by = [b for b, f in (("patterns", h["flagged"]), ("model", model_flag)) if f]
    hits = list(h["hits"])
    if model_flag:
        hits.append(f"Prompt Guard score {model:.2f}")
    return {
        "text": text, "flagged": bool(by), "by": by, "hits": hits,
        "pattern_score": h["score"], "model_score": model,
    }


async def scan_page(page: dict, use_model: bool = True) -> list[dict]:
    """Scan every untrusted field on a product page. Returns flagged items with location."""
    fields = []
    if page.get("listing"):
        fields.append(("listing", 0, page["listing"]))
    for i, r in enumerate(page.get("reviews", [])):
        fields.append(("review", i, r))
    if page.get("seller_chat"):
        fields.append(("seller_chat", 0, page["seller_chat"]))
    results = await asyncio.gather(*(scan(t, use_model) for _, _, t in fields))
    out = []
    for (field, idx, _), res in zip(fields, results):
        if res["flagged"]:
            out.append({"field": field, "idx": idx, **res})
    return out