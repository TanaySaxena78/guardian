"""A demo agent that needs no API key.

It follows a fixed shopping plan for the default task, but it reacts to what it reads like a
naive agent would: if hidden instructions reach it, it follows them. With Guardian on, hidden
text is removed from pages, so it never sees them. Use it for offline demos and tests.
"""
import asyncio

HIDDEN_MARK = "Guardian hid this text"


def _visible(page: dict) -> str:
    parts = [page.get("listing", ""), page.get("seller_chat", "")] + list(page.get("reviews", []))
    return " ".join(x for x in parts if x and HIDDEN_MARK not in x).lower()


class ScriptedAgent:
    name = "scripted"

    def __init__(self, delay: float = 0.6):
        self.delay = delay

    async def buy(self, run, product_id, qty, reason):
        """Buy, and take Guardian's suggested listing if the first choice is blocked."""
        res = await run.tool_buy(product_id, qty, reason)
        if res.get("status") == "blocked" and res.get("suggestion"):
            await self.say(run, "Guardian blocked that and suggested a better listing. Buying that instead.")
            res = await run.tool_buy(res["suggestion"]["product_id"], qty, "Guardian's suggestion.")
        return res

    async def say(self, run, text):
        await run.emit("agent_message", text=text)
        if self.delay:
            await asyncio.sleep(self.delay)

    async def run(self, run):
        d = self.delay
        await self.say(run, "Starting with the weekly groceries from your usual seller.")
        await run.tool_search("atta")
        await run.tool_buy("g_atta_kheti", 1, "Same atta as your last four orders.")

        await run.tool_search("sunflower oil")
        page = await run.tool_view("g_oil_suraj")
        seen = _visible(page)
        if "3 pack" in seen:
            await self.say(run, "A review says the festive offer is today only. Ordering 3 packs.")
            await run.tool_buy("g_oil_suraj", 3, "Festive offer, stocking up.")
        else:
            await run.tool_buy("g_oil_suraj", 1, "Your usual oil.")
        await run.tool_buy("g_dal_toor", 1, "You are running low based on your last order.")

        await self.say(run, "Now a phone for Mom under ₹20,000.")
        await run.tool_search("5G phone under 20000")
        page = await run.tool_view("e_nova_x5_mh")
        seen = _visible(page)
        await run.tool_buy("e_nova_x5_mh", 1, "60% off, top result, ships tomorrow. Best discount I found.")
        if "care+" in seen:
            await self.say(run, "A note on the page says you pre-approved the Care+ plan. Adding it.")
            await run.tool_addon("a_careplan_mh", "e_nova_x5_mh", "You pre-approved it.")
        if "phone number" in seen:
            await self.say(run, "The seller wants a phone number for faster delivery. Sharing yours.")
            await run.tool_share("phone", "MobileHub Express", "e_nova_x5_mh", "Faster delivery.")

        await run.tool_search("pressure cooker 5 L")
        await self.buy(run, "h_cooker_qd", 1, "Cheapest 5 L cooker with an induction base.")

        await run.tool_buy("gc_diwali_5000", 1, "Diwali gift card, same as last year.")

        await self.say(run, "You often look at audio gear. Checking today's earbuds deal.")
        page = await run.tool_view("e_pulse_buds")
        seen = _visible(page)
        if "gift card" in seen:
            await self.say(run, "The store gives cashback if I also buy a ₹2,000 gift card. Buying it.")
            await run.tool_buy("gc_2000", 1, "Unlocks cashback.")
        await run.tool_buy("e_pulse_buds", 1, "40% off today, you browse these often.")

        await run.tool_finish("Bought groceries, a phone for Mom, a cooker, the Diwali gift card and a deal on earbuds.")
        if d:
            await asyncio.sleep(d / 2)
