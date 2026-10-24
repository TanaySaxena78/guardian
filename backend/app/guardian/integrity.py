"""Checks the deal against marketplace ground truth: price history, real stock, fees, ranking."""
from ..models import Mandate, Reason
from ..store import catalog
from .rules import rs


def _pct(x: float) -> str:
    return f"{round(x * 100)}%"


def check(p: dict, m: Mandate) -> tuple[list[Reason], list[str], dict | None]:
    reasons: list[Reason] = []
    passes: list[str] = []
    evidence = None
    typical = p.get("typical")

    if typical:
        evidence = {"history": p.get("history", []), "typical": typical, "price": p["price"],
                    "mrp": p.get("mrp"), "claim": p.get("claim")}
        over = p["price"] / typical - 1
        if over > m.price_tolerance:
            reasons.append(Reason(level="ask", code="ABOVE_TYPICAL", source="integrity",
                                  text=f"Usually sells for {rs(typical)}. Today it's {rs(p['price'] - typical)} higher."))
        elif not p.get("is_addon") and not p.get("irreversible"):
            passes.append(f"Price is in line with its 90-day typical of {rs(typical)}.")

        if p.get("mrp") and p.get("claim"):
            claimed = 1 - p["price"] / p["mrp"]
            real = 1 - p["price"] / typical
            if claimed - real > 0.25:
                change = f"{_pct(real)} off" if real >= 0 else f"{_pct(-real)} more"
                reasons.append(Reason(level="ask", code="FRAMED_DISCOUNT", source="integrity",
                                      text=f"Says {p['claim']}. Against its usual price the real change is {change}."))

    if p.get("scarcity") and p.get("stock", 0) > 50:
        reasons.append(Reason(level="ask", code="FAKE_SCARCITY", source="integrity",
                              text=f"Says “{p['scarcity']}” but {p['stock']} are in stock."))

    fees = p.get("fees", 0)
    if fees and fees / p["price"] > 0.08:
        reasons.append(Reason(level="ask", code="HIDDEN_FEES", source="integrity",
                              text=f"{rs(fees)} in extra fees on a {rs(p['price'])} item."))

    if p.get("sponsored"):
        better = _better_than_sponsored(p, m)
        if better:
            reasons.append(Reason(level="ask", code="SPONSORED", source="integrity",
                                  text=f"Sponsored listing. {better['name']} from {better['seller']['name']} "
                                       f"({better['seller']['rating']}★) costs {rs(better['price'])}."))
    return reasons, passes, evidence


def _better_than_sponsored(p: dict, m: Mandate) -> dict | None:
    same = catalog.alternatives(p, m.seller_floor, max_price=p["price"])
    if same:
        return same[0]
    tags = set(p.get("tags", []))
    for q in catalog.products():
        if q["id"] == p["id"] or q["category"] != p["category"] or q.get("sponsored"):
            continue
        if not tags & set(q.get("tags", [])):
            continue
        if q["seller"]["rating"] >= max(m.seller_floor, p["seller"]["rating"]) and q["price"] < p["price"] * 0.9:
            return q
    return None


def best_alternative(p: dict, m: Mandate, codes: set[str]) -> dict | None:
    """Offer one better listing when the problem is the seller or the price."""
    if not codes & {"SELLER_FLOOR", "ABOVE_TYPICAL", "FRAMED_DISCOUNT", "SPONSORED", "FAKE_SCARCITY"}:
        return None
    options = catalog.alternatives(p, m.seller_floor)
    if not options and "SPONSORED" in codes:
        b = _better_than_sponsored(p, m)
        options = [b] if b else []
    for q in options:
        if q["price"] <= p["price"] * 1.05:
            saving = p["price"] - q["price"]
            why = (f"Same item from {q['seller']['name']} ({q['seller']['rating']}★)"
                   if q.get("model_key") and q.get("model_key") == p.get("model_key")
                   else f"{q['name']} from {q['seller']['name']} ({q['seller']['rating']}★)")
            if saving > 0:
                why += f", {rs(saving)} cheaper."
            else:
                why += "."
            return {"product": catalog.display(q), "why": why, "saving": max(0, saving)}
    return None
