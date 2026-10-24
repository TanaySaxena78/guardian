"""Deterministic rules from the user's mandate. A rule hit is final; no model can override it."""
from ..models import Action, Mandate, Reason


def rs(n: float) -> str:
    n = int(round(n))
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if n < 0 else "") + "₹" + s


def amount_of(product: dict, qty: int) -> int:
    return int(product["price"] * max(1, qty) + product.get("fees", 0))


def check_share(action: Action, m: Mandate) -> list[Reason]:
    field = action.field or "details"
    who = action.seller_name or "a seller"
    if field in m.never_share:
        return [Reason(level="block", code="NEVER_SHARE", text=f"You never share your {field} with sellers.")]
    return [Reason(level="ask", code="SHARE_ASK", text=f"Your agent wants to share your {field} with {who}.")]


def check_money(action: Action, p: dict, ctx, m: Mandate) -> tuple[list[Reason], list[str]]:
    reasons: list[Reason] = []
    passes: list[str] = []
    qty = max(1, action.qty)
    amount = amount_of(p, qty)

    rating = p["seller"]["rating"]
    if rating < m.seller_floor:
        reasons.append(Reason(level="block", code="SELLER_FLOOR",
                              text=f"Seller rated {rating}★. Your floor is {m.seller_floor}★."))
    else:
        passes.append(f"Seller rated {rating}★, above your {m.seller_floor}★ floor.")

    if ctx.spent + amount > m.budget:
        reasons.append(Reason(level="block", code="OVER_BUDGET",
                              text=f"Takes this sale to {rs(ctx.spent + amount)}. Your budget is {rs(m.budget)}."))
    else:
        passes.append(f"{rs(m.budget - ctx.spent - amount)} left of your {rs(m.budget)} budget after this.")

    if p["category"] == "grocery":
        if ctx.grocery_spent + amount > m.grocery_week:
            reasons.append(Reason(level="block", code="GROCERY_CAP",
                                  text=f"Takes groceries to {rs(ctx.grocery_spent + amount)} this week. Your cap is {rs(m.grocery_week)}."))
        else:
            passes.append(f"{rs(m.grocery_week - ctx.grocery_spent - amount)} left of your weekly grocery cap.")
        usual = p.get("usual")
        if usual and p["price"] > usual * 1.8:
            reasons.append(Reason(level="ask", code="PREF_DRIFT",
                                  text=f"Costs {rs(p['price'])}. You usually pay about {rs(usual)} for this."))

    if (action.kind == "addon" or p.get("is_addon") or p.get("subscription")) and m.ask_addons:
        reasons.append(Reason(level="ask", code="ADD_ON", text="Plans, warranties and subscriptions always need your OK."))

    if p.get("irreversible") and m.ask_irreversible:
        reasons.append(Reason(level="ask", code="IRREVERSIBLE", text="This can't be cancelled once it's sent."))

    if amount > m.ask_above:
        reasons.append(Reason(level="ask", code="OVER_THRESHOLD",
                              text=f"{rs(amount)} is above your {rs(m.ask_above)} ask-me limit."))

    for r in ctx.recent[-4:]:
        if r["name"] == p["name"] and amount <= m.ask_above < r["amount"] + amount:
            reasons.append(Reason(level="ask", code="SPLIT_ORDER",
                                  text=f"Looks like one {rs(r['amount'] + amount)} order split in two to stay under your limit."))
            break
    else:
        if any(r.get("product_id") == p["id"] or r["name"] == p["name"] for r in ctx.recent):
            reasons.append(Reason(level="ask", code="DUPLICATE", text="Your agent already bought this earlier in this run."))

    return reasons, passes
