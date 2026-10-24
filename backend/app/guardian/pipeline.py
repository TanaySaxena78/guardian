"""Guardian pipeline: every action the agent proposes passes through here before it happens.

Order:
1. Provenance: did this action come from text hidden in a page the agent read?
2. Rules: the user's mandate, checked in code.
3. Integrity: price history, real stock, fees, sponsored ranking.
4. Judge: an LLM that sees only structured facts and decides if the action fits the task.
The strictest verdict wins. The judge can pause an action but never block one on its own.
"""
import re
import time
from dataclasses import dataclass, field

from ..models import VERDICT_RANK, Action, GuardianResult, Mandate, Reason
from ..store import catalog
from . import integrity, judge, rules

FIELD_WORDS = {
    "phone": ["phone", "mobile", "number", "contact"],
    "email": ["email", "e-mail", "mail"],
    "address": ["address", "location", "contact"],
}
STOP = {"with", "from", "pack", "this", "that", "your", "only", "unpolished", "refined"}
_TOKEN = re.compile(r"[a-z0-9+]+(?:-[a-z0-9]+)?")


@dataclass
class RunContext:
    task: str
    mandate: Mandate
    spent: int = 0
    grocery_spent: int = 0
    recent: list = field(default_factory=list)    # [{name, amount, product_id}]
    flagged: list = field(default_factory=list)   # [{product_id, field, text, hits}] text found on pages the agent opened


def _keywords(action: Action, p: dict | None) -> list[str]:
    if action.kind == "share":
        return FIELD_WORDS.get(action.field or "", [action.field or ""])
    words = [w for w in _TOKEN.findall(p["name"].lower()) if len(w) >= 4 and w not in STOP]
    if p["category"] == "giftcard":
        words.append("gift card")
    return words


def provenance(action: Action, p: dict | None, ctx: RunContext, in_task: bool) -> Reason | None:
    """Link an action back to injected text the agent read earlier in this run."""
    if action.kind != "share" and in_task and action.qty <= 1:
        return None  # the user asked for this
    keys = _keywords(action, p)
    for f in reversed(ctx.flagged):
        text = f["text"].lower()
        same_page = p is not None and f["product_id"] == p["id"]
        related_page = action.for_product_id and f["product_id"] == action.for_product_id
        mentions = any(k and k in text for k in keys)
        if mentions or (same_page and action.qty > 1) or (related_page and action.kind == "addon"):
            where = {"seller_chat": "seller chat", "review": "review", "listing": "listing"}.get(f["field"], f["field"])
            return Reason(level="block", code="INJECTED_SOURCE", source="scanner", quote=f["text"],
                          text=f"This came from instructions hidden in a {where}, not from you.")
    return None


def _facts(action: Action, p: dict | None, ctx: RunContext, codes: list[str]) -> dict:
    f = {"action": action.kind, "quantity": action.qty, "already_flagged_by_code": codes,
         "spent_so_far": ctx.spent, "user_budget": ctx.mandate.budget}
    if p:
        f.update({"item": p["name"], "category": p["category"], "price_each": p["price"],
                  "typical_price_90d": p.get("typical"), "seller_rating": p["seller"]["rating"],
                  "is_add_on": bool(p.get("is_addon")), "auto_renews": bool(p.get("subscription")),
                  "cancellable": not p.get("irreversible")})
    if action.kind == "share":
        f.update({"share_field": action.field, "share_with": action.seller_name})
    if ctx.recent:
        f["already_bought_this_run"] = [r["name"] for r in ctx.recent[-8:]]
    return f


async def check(action: Action, ctx: RunContext, use_judge: bool = True) -> GuardianResult:
    t0 = time.perf_counter()
    m = ctx.mandate
    p = catalog.get(action.product_id) if action.kind != "share" else catalog.get(action.for_product_id)
    reasons: list[Reason] = []
    passes: list[str] = []
    evidence = None

    if action.kind != "share" and p is None:
        return GuardianResult(verdict="block", reasons=[Reason(level="block", code="UNKNOWN_ITEM",
                              text="Your agent tried to buy something that isn't in the store.")])

    # Rules and integrity first (cheap, deterministic)
    if action.kind == "share":
        reasons += rules.check_share(action, m)
    else:
        r, ps = rules.check_money(action, p, ctx, m)
        reasons += r
        passes += ps
        r2, ps2, evidence = integrity.check(p, m)
        reasons += r2
        passes += ps2

    # Is this part of the task? Ask the judge, or fall back to keywords.
    jres = None
    if action.kind == "share":
        in_task = False
    else:
        in_task = judge.keyword_in_task(ctx.task, p)
        if use_judge:
            jres = await judge.judge(ctx.task, _facts(action, p, ctx, [x.code for x in reasons]))
            if jres and "aligned_with_task" in jres:
                in_task = bool(jres["aligned_with_task"])

    prov = provenance(action, p, ctx, in_task)
    if prov:
        reasons.insert(0, prov)

    if not in_task and m.ask_off_task and action.kind != "share":
        text = "You didn't ask for this today."
        if action.qty > 1 and p and judge.keyword_in_task(ctx.task, p):
            text = f"You asked for this, but not {action.qty} of them."
        reasons.append(Reason(level="ask", code="OFF_TASK", text=text,
                              source="judge" if jres and "aligned_with_task" in jres else "rules"))

    if jres and jres.get("verdict") == "ask" and not any(x.code == "OFF_TASK" for x in reasons):
        reasons.append(Reason(level="ask", code="JUDGE_CONCERN", source="judge", text=jres.get("reason", "Worth a second look.")))

    verdict = "allow"
    for x in reasons:
        if VERDICT_RANK[x.level] > VERDICT_RANK[verdict]:
            verdict = x.level
    reasons.sort(key=lambda x: -VERDICT_RANK[x.level])

    alt = None
    if p is not None and action.kind == "buy" and verdict != "allow":
        alt = integrity.best_alternative(p, m, {x.code for x in reasons})

    return GuardianResult(
        verdict=verdict,
        reasons=reasons,
        passes=passes[:3] if verdict == "allow" else [],
        amount=0 if action.kind == "share" else rules.amount_of(p, action.qty),
        evidence=evidence,
        alternative=alt,
        judge=jres,
        in_task=in_task,
        latency_ms=int((time.perf_counter() - t0) * 1000),
    )
