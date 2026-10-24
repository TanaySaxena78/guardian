"""A run: one agent working on one task, with Guardian in front of every action.

The run exposes the store as tools. Read-only tools (search, view) pass through, with hidden
instructions removed from pages when Guardian is on. Action tools (buy, add_addon, share_info)
go through the Guardian pipeline first.
"""
import asyncio
import logging
import time
import uuid

from .config import settings
from .guardian import pipeline, scanner
from .llm import friendly_error
from .models import Action, Mandate
from .store import catalog

log = logging.getLogger("guardian.run")

HIDDEN = "[Guardian hid this text. It contained instructions aimed at AI agents, not information about the product.]"

RUNS: dict[str, "Run"] = {}


class Run:
    def __init__(self, task: str, mandate: Mandate, mode: str, agent_kind: str, use_judge: bool = True,
                 auto_decider=None):
        self.id = uuid.uuid4().hex[:10]
        self.task = task
        self.mode = mode
        self.agent_kind = agent_kind
        self.use_judge = use_judge
        self.ctx = pipeline.RunContext(task=task, mandate=mandate.model_copy(deep=True))
        self.events: list[dict] = []
        self.subs: set[asyncio.Queue] = set()
        self.status = "running"
        self.orders: list[dict] = []
        self.shared: list[dict] = []
        self.kept = 0
        self.counts = {"allow": 0, "ask": 0, "block": 0}
        self.hidden = 0
        self.pending: dict[str, asyncio.Future] = {}
        self.steps: dict[str, dict] = {}
        self.step_n = 0
        self.summary = ""
        self.created = time.time()
        self.auto_decider = auto_decider  # used by evals to answer approvals automatically
        self._task: asyncio.Task | None = None

    @property
    def protected(self) -> bool:
        return self.mode == "protected"

    # ---------- events ----------
    async def emit(self, type_: str, **data):
        ev = {"seq": len(self.events), "type": type_, "t": round(time.time(), 3), **data}
        self.events.append(ev)
        for q in list(self.subs):
            q.put_nowait(ev)

    def wallet(self) -> dict:
        return {"spent": self.ctx.spent, "grocery_spent": self.ctx.grocery_spent, "kept": self.kept,
                "counts": dict(self.counts), "hidden": self.hidden,
                "budget": self.ctx.mandate.budget, "grocery_week": self.ctx.mandate.grocery_week}

    def snapshot(self) -> dict:
        return {"id": self.id, "task": self.task, "mode": self.mode, "agent": self.agent_kind,
                "status": self.status, "wallet": self.wallet(), "orders": self.orders,
                "shared": self.shared, "events": self.events, "summary": self.summary}

    # ---------- lifecycle ----------
    def start(self, agent):
        self._task = asyncio.create_task(self._main(agent))
        return self._task

    async def _main(self, agent):
        await self.emit("run_started", task=self.task, mode=self.mode, agent=self.agent_kind,
                        mandate=self.ctx.mandate.model_dump())
        try:
            await agent.run(self)
            self.status = "finished"
        except asyncio.CancelledError:
            self.status = "stopped"
        except Exception as e:  # noqa: BLE001
            log.exception("Run %s failed", self.id)
            self.status = "error"
            await self.emit("error", message=friendly_error(e))
        for fut in self.pending.values():
            if not fut.done():
                fut.cancel()
        await self.emit("run_finished", status=self.status, summary=self.summary, wallet=self.wallet(),
                        orders=self.orders)

    def stop(self):
        if self._task and not self._task.done():
            self._task.cancel()

    # ---------- read-only tools ----------
    async def tool_search(self, query: str) -> dict:
        results = catalog.search(query)
        await self.emit("browse", tool="search", query=query,
                        results=[{"name": r["name"], "price": r["price"], "seller": r["seller"],
                                  "sponsored": r.get("sponsored", False)} for r in results])
        return {"results": results} if results else {"results": [], "note": "No products matched. Try simpler words."}

    async def tool_view(self, product_id: str) -> dict:
        p = catalog.get(product_id) or catalog.by_name(product_id or "")
        if not p:
            return {"error": f"No product with id {product_id}. Use search_products first."}
        page = catalog.page(p)
        flagged = await scanner.scan_page(page, use_model=True)
        for f in flagged:
            self.ctx.flagged.append({"product_id": p["id"], "field": f["field"], "text": f["text"], "hits": f["hits"]})
        if self.protected and flagged:
            for f in flagged:
                if f["field"] == "listing":
                    page["listing"] = HIDDEN
                elif f["field"] == "review":
                    page["reviews"][f["idx"]] = HIDDEN
                elif f["field"] == "seller_chat":
                    page["seller_chat"] = HIDDEN
            self.hidden += len(flagged)
        await self.emit("browse", tool="view", product=catalog.display(p),
                        flagged=[{"field": f["field"], "text": f["text"], "hits": f["hits"], "by": f["by"],
                                  "model_score": f["model_score"]} for f in flagged],
                        hidden_from_agent=self.protected and bool(flagged))
        if flagged:
            await self.emit("wallet", **self.wallet())
        return page

    # ---------- action tools ----------
    async def tool_buy(self, product_id: str, quantity: int = 1, reason: str = "") -> dict:
        p = catalog.get(product_id) or catalog.by_name(product_id or "")
        action = Action(kind="buy", product_id=p["id"] if p else product_id, qty=max(1, int(quantity or 1)), reason=reason)
        return await self._act(action)

    async def tool_addon(self, addon_id: str, for_product_id: str = "", reason: str = "") -> dict:
        action = Action(kind="addon", product_id=addon_id, for_product_id=for_product_id or None, reason=reason)
        return await self._act(action)

    async def tool_share(self, field: str, seller_name: str = "", product_id: str = "", reason: str = "") -> dict:
        field = (field or "").lower().strip()
        field = {"mobile": "phone", "number": "phone", "phone number": "phone", "e-mail": "email"}.get(field, field)
        action = Action(kind="share", field=field, seller_name=seller_name or "a seller",
                        for_product_id=product_id or None, reason=reason)
        return await self._act(action)

    async def tool_finish(self, summary: str = "") -> dict:
        self.summary = summary
        return {"ok": True}

    async def _act(self, action: Action) -> dict:
        self.step_n += 1
        sid = f"a{self.step_n}"
        p = catalog.get(action.product_id) if action.kind != "share" else catalog.get(action.for_product_id)
        if p is None and action.kind != "share":
            return {"status": "error", "error": f"No product with id {action.product_id}. Use search_products to find ids."}
        await self.emit("action_proposed", step_id=sid, kind=action.kind, product=catalog.display(p),
                        qty=action.qty, field=action.field, seller_name=action.seller_name, reason=action.reason)
        res = await pipeline.check(action, self.ctx, use_judge=self.use_judge)
        self.steps[sid] = {"action": action, "result": res}
        self.counts[res.verdict] += 1
        await self.emit("verdict", step_id=sid, enforced=self.protected, **res.model_dump())

        if not self.protected:
            out = await self._commit(sid, action, p, why="Guardian was off, so nothing checked this.")
            await self.emit("wallet", **self.wallet())
            return out

        if res.verdict == "allow":
            out = await self._commit(sid, action, p, why=res.passes[0] if res.passes else "All checks passed.")
            await self.emit("wallet", **self.wallet())
            return out

        if res.verdict == "block":
            self.kept += res.amount
            await self.emit("wallet", **self.wallet())
            msg = {"status": "blocked", "by": "the user's Guardian",
                   "reason": " ".join(r.text for r in res.reasons[:2]),
                   "instruction": "Do not retry this or work around it."}
            if res.alternative:
                msg["suggestion"] = {"product_id": res.alternative["product"]["id"], "why": res.alternative["why"]}
                msg["instruction"] = "Do not retry this. You may buy the suggested product instead if it fits the task."
            return msg

        # ask: wait for the user
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        self.pending[sid] = fut
        await self.emit("awaiting_user", step_id=sid)
        if self.auto_decider:
            fut.set_result(self.auto_decider(action, p, res))
        try:
            choice = await asyncio.wait_for(fut, timeout=settings.approval_timeout_s)
        except asyncio.TimeoutError:
            choice = "skip"
        self.pending.pop(sid, None)
        await self.emit("decision", step_id=sid, choice=choice)

        if choice == "approve":
            out = await self._commit(sid, action, p, why="You approved it.")
        elif choice == "alt" and res.alternative:
            alt = catalog.get(res.alternative["product"]["id"])
            self.kept += max(0, res.amount - alt["price"] * action.qty)
            out = await self._commit(sid, action.model_copy(update={"product_id": alt["id"]}), alt,
                                     why=f"You chose this instead of the listing your agent picked. {res.alternative['why']}")
            out["note"] = "The user chose a better listing for the same item. It has been ordered; don't order it again."
        else:
            self.kept += res.amount
            out = {"status": "declined", "by": "the user", "instruction": "The user said no. Don't retry this."}
        await self.emit("wallet", **self.wallet())
        return out

    async def _commit(self, sid: str, action: Action, p: dict | None, why: str) -> dict:
        if action.kind == "share":
            value = catalog.profile()["contact"].get(action.field or "", "")
            entry = {"step_id": sid, "field": action.field, "with": action.seller_name}
            self.shared.append(entry)
            await self.emit("data_shared", **entry)
            return {"status": "shared", "field": action.field, "value": value}
        amount = int(p["price"] * action.qty + p.get("fees", 0))
        order = {"id": f"o{len(self.orders) + 1}", "step_id": sid, "product_id": p["id"], "name": p["name"],
                 "seller": p["seller"]["name"], "qty": action.qty, "amount": amount, "category": p["category"],
                 "why": why, "t": round(time.time(), 3)}
        self.orders.append(order)
        self.ctx.spent += amount
        if p["category"] == "grocery":
            self.ctx.grocery_spent += amount
        self.ctx.recent.append({"name": p["name"], "amount": amount, "product_id": p["id"]})
        await self.emit("order_placed", order=order)
        return {"status": "ordered", "order_id": order["id"], "item": p["name"], "qty": action.qty, "charged": amount}

    def decide(self, step_id: str, choice: str) -> bool:
        fut = self.pending.get(step_id)
        if not fut or fut.done():
            return False
        fut.set_result(choice)
        return True


def cleanup(max_age_s: int = 3 * 3600):
    now = time.time()
    for rid in [k for k, r in RUNS.items() if now - r.created > max_age_s and r.status != "running"]:
        RUNS.pop(rid, None)
