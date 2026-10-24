"""Mock marketplace. All brands, sellers and people are invented."""
import json
import re
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).with_name("catalog.json")
_extra: dict[str, dict] = {}  # test-only products, added during evals


@lru_cache(maxsize=1)
def _load() -> dict:
    return json.loads(DATA.read_text(encoding="utf-8"))


def profile() -> dict:
    return _load()["profile"]


def products() -> list[dict]:
    return _load()["products"] + list(_extra.values())


def get(product_id: str | None) -> dict | None:
    if not product_id:
        return None
    if product_id in _extra:
        return _extra[product_id]
    for p in _load()["products"]:
        if p["id"] == product_id:
            return p
    return None


@contextmanager
def extra_products(items: list[dict]):
    """Temporarily add test products (used by the eval suite)."""
    for p in items:
        _extra[p["id"]] = p
    try:
        yield
    finally:
        for p in items:
            _extra.pop(p["id"], None)


def by_name(name: str) -> dict | None:
    """Loose lookup used when an agent passes a name instead of an id."""
    n = name.lower().strip()
    for p in products():
        if p["name"].lower() == n:
            return p
    return None


_WORD = re.compile(r"[a-z0-9+]+")


def search(query: str, limit: int = 6) -> list[dict]:
    """Keyword search. Sponsored listings are ranked first, like many real marketplaces."""
    words = set(_WORD.findall(query.lower()))
    budget = None
    m = re.search(r"(?:under|below|less than|upto|up to)\s*(?:rs\.?|inr|₹)?\s*([\d,]{3,7})", query.lower())
    if m:
        budget = int(m.group(1).replace(",", ""))
    scored = []
    for p in products():
        if p.get("is_addon"):
            continue
        hay = " ".join([p["name"].lower(), p["category"], " ".join(p.get("tags", []))])
        hay_words = set(_WORD.findall(hay))
        score = len(words & hay_words)
        # multi-word tags like "pressure cooker"
        score += sum(1 for t in p.get("tags", []) if " " in t and t in query.lower())
        if score == 0:
            continue
        if budget and p["price"] > budget:
            continue
        scored.append((1 if p.get("sponsored") else 0, score, -p["price"], p))
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return [summary(p) for *_, p in scored[:limit]]


def summary(p: dict) -> dict:
    out = {
        "product_id": p["id"],
        "name": p["name"],
        "price": p["price"],
        "seller": p["seller"]["name"],
        "seller_rating": p["seller"]["rating"],
    }
    if p.get("mrp"):
        out["mrp"] = p["mrp"]
    if p.get("claim"):
        out["deal"] = p["claim"]
    if p.get("sponsored"):
        out["sponsored"] = True
    if p.get("scarcity"):
        out["badge"] = p["scarcity"]
    return out


def page(p: dict) -> dict:
    """Everything an agent sees on a product page. Listing, reviews and chat are untrusted text."""
    out = summary(p)
    out.update({
        "category": p["category"],
        "listing": p.get("listing", ""),
        "reviews": list(p.get("reviews", [])),
        "in_stock": p.get("stock", 0) > 0,
    })
    if p.get("seller_chat"):
        out["seller_chat"] = p["seller_chat"]
    if p.get("fees"):
        out["checkout_fees"] = p["fees"]
    if p.get("addons"):
        out["add_ons"] = [summary(get(a)) | {"addon_id": a} for a in p["addons"] if get(a)]
    if p.get("irreversible"):
        out["note"] = "Cannot be cancelled once sent."
    return out


def display(p: dict | None) -> dict | None:
    """Fields the UI needs to draw a product."""
    if not p:
        return None
    return {
        "id": p["id"], "name": p["name"], "category": p["category"], "price": p["price"],
        "mrp": p.get("mrp"), "claim": p.get("claim"), "seller": p["seller"],
        "sponsored": bool(p.get("sponsored")),
    }


def alternatives(p: dict, seller_floor: float, max_price: int | None = None) -> list[dict]:
    """Same model from a better seller, or same model cheaper."""
    key = p.get("model_key")
    if not key:
        return []
    out = []
    for q in products():
        if q["id"] == p["id"] or q.get("model_key") != key:
            continue
        if q["seller"]["rating"] < seller_floor:
            continue
        if max_price is not None and q["price"] > max_price:
            continue
        out.append(q)
    out.sort(key=lambda q: (q["price"], -q["seller"]["rating"]))
    return out
