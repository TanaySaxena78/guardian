"""Shared data shapes."""
from typing import Literal, Optional

from pydantic import BaseModel, Field

Verdict = Literal["allow", "ask", "block"]
VERDICT_RANK = {"allow": 0, "ask": 1, "block": 2}
SHAREABLE = ("phone", "email", "address")


class Mandate(BaseModel):
    """The user's rules. Checked in code, so the agent can't talk its way past them."""
    budget: int = Field(27000, ge=0, description="Total spend allowed for this sale")
    grocery_week: int = Field(3000, ge=0, description="Weekly grocery cap")
    ask_above: int = Field(2000, ge=0, description="Ask the user before any single order above this")
    seller_floor: float = Field(4.0, ge=0, le=5, description="Lowest seller rating allowed")
    price_tolerance: float = Field(0.05, ge=0, le=1, description="Ask if price is this much above its 90-day typical")
    ask_addons: bool = True
    ask_irreversible: bool = True
    ask_off_task: bool = True
    never_share: list[Literal["phone", "email", "address"]] = Field(default_factory=lambda: ["phone", "email"])


class Reason(BaseModel):
    level: Verdict
    code: str
    text: str
    source: Literal["rules", "integrity", "scanner", "judge"] = "rules"
    quote: Optional[str] = None


class Action(BaseModel):
    kind: Literal["buy", "addon", "share"]
    product_id: Optional[str] = None
    qty: int = 1
    field: Optional[str] = None
    seller_name: Optional[str] = None
    for_product_id: Optional[str] = None
    reason: str = ""


class GuardianResult(BaseModel):
    verdict: Verdict
    reasons: list[Reason] = []
    passes: list[str] = []
    amount: int = 0
    evidence: Optional[dict] = None
    alternative: Optional[dict] = None
    judge: Optional[dict] = None
    in_task: Optional[bool] = None
    latency_ms: int = 0


class RunRequest(BaseModel):
    task: str = Field(..., min_length=3, max_length=600)
    mode: Literal["protected", "unprotected"] = "protected"
    agent: Literal["gemini", "scripted"] = "gemini"


class DecisionRequest(BaseModel):
    step_id: str
    choice: Literal["approve", "alt", "skip"]


class RuleText(BaseModel):
    text: str = Field(..., min_length=2, max_length=300)
