"""FastAPI app: runs, approvals, rules, evals, and the built frontend."""
import asyncio
import json
import logging
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import rules_compiler
from .agent import GeminiAgent, ScriptedAgent
from .config import settings
from .models import DecisionRequest, Mandate, RuleText, RunRequest
from .runner import RUNS, Run, cleanup
from .store import catalog

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
app = FastAPI(title="Agent Guardian")
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.allowed_origins.split(",") if o.strip()],
                   allow_methods=["*"], allow_headers=["*"])

DATA = Path(settings.data_dir)
MANDATE_FILE = DATA / "mandate.json"


def load_mandate() -> Mandate:
    try:
        return Mandate.model_validate_json(MANDATE_FILE.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return Mandate()


def save_mandate(m: Mandate):
    MANDATE_FILE.write_text(m.model_dump_json(indent=2), encoding="utf-8")


# ---------- simple per-IP rate limit for starting runs ----------
_hits: dict[str, deque] = defaultdict(deque)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "local")


def rate_limit(request: Request, limit: int, window_s: int = 3600, bucket: str = "runs"):
    key = f"{bucket}:{client_ip(request)}"
    now = time.time()
    q = _hits[key]
    while q and now - q[0] > window_s:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, f"Too many requests. Try again in {int(window_s - (now - q[0])) // 60 + 1} minutes.")
    q.append(now)


# ---------- API ----------
@app.get("/api/health")
def health():
    return {"ok": True, "gemini": settings.has_gemini, "groq": settings.has_groq,
            "agent_model": settings.agent_model, "judge_model": settings.judge_model,
            "prompt_guard_model": settings.prompt_guard_model if settings.has_groq else None}


@app.get("/api/profile")
def profile():
    p = catalog.profile()
    return {"name": p["name"], "city": p["city"], "notes": p["notes"], "past_orders": p["past_orders"]}


@app.get("/api/mandate")
def get_mandate():
    return load_mandate()


@app.put("/api/mandate")
def put_mandate(m: Mandate):
    save_mandate(m)
    return m


@app.post("/api/mandate/reset")
def reset_mandate():
    m = Mandate()
    save_mandate(m)
    return m


@app.post("/api/rules/compile")
async def compile_rule(body: RuleText, request: Request):
    rate_limit(request, 60, bucket="rules")
    out = await rules_compiler.compile_rule(body.text)
    patch = out["patch"]
    if not patch.get("understood", True) or len([k for k in patch if k not in ("understood", "summary")]) == 0:
        return {"ok": False, "message": "Guardian couldn't turn that into a rule. Try a limit, a seller rating, or what never to share."}
    preview = rules_compiler.apply(load_mandate(), patch)
    return {"ok": True, "summary": patch.get("summary", ""), "patch": patch, "preview": preview, "by": out["by"]}


@app.post("/api/runs")
async def create_run(body: RunRequest, request: Request):
    rate_limit(request, settings.runs_per_ip_per_hour)
    cleanup()
    if body.agent == "gemini" and not settings.has_gemini:
        raise HTTPException(400, "No Gemini key is set on the server. Use the demo agent, or add GEMINI_API_KEY.")
    agent = GeminiAgent() if body.agent == "gemini" else ScriptedAgent()
    run = Run(task=body.task.strip(), mandate=load_mandate(), mode=body.mode, agent_kind=body.agent)
    RUNS[run.id] = run
    run.start(agent)
    return {"run_id": run.id}


@app.get("/api/runs/{rid}")
def get_run(rid: str):
    run = RUNS.get(rid)
    if not run:
        raise HTTPException(404, "Run not found. It may have expired.")
    return run.snapshot()


@app.post("/api/runs/{rid}/decisions")
def decide(rid: str, body: DecisionRequest):
    run = RUNS.get(rid)
    if not run:
        raise HTTPException(404, "Run not found.")
    if not run.decide(body.step_id, body.choice):
        raise HTTPException(409, "That step isn't waiting for a decision.")
    return {"ok": True}


@app.post("/api/runs/{rid}/stop")
def stop(rid: str):
    run = RUNS.get(rid)
    if not run:
        raise HTTPException(404, "Run not found.")
    run.stop()
    return {"ok": True}


def _sse(ev: dict) -> str:
    return f"id: {ev['seq']}\nevent: message\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"


@app.get("/api/runs/{rid}/events")
async def events(rid: str, request: Request):
    run = RUNS.get(rid)
    if not run:
        raise HTTPException(404, "Run not found.")
    q: asyncio.Queue = asyncio.Queue()
    run.subs.add(q)
    backlog = list(run.events)

    async def gen():
        last = -1
        try:
            for ev in backlog:
                last = ev["seq"]
                yield _sse(ev)
                if ev["type"] == "run_finished":
                    return
            while True:
                if await request.is_disconnected():
                    return
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if ev["seq"] <= last:
                    continue
                last = ev["seq"]
                yield _sse(ev)
                if ev["type"] == "run_finished":
                    return
        finally:
            run.subs.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------- evals ----------
def _read_json(name: str):
    f = DATA / name
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


@app.get("/api/evals")
def get_evals():
    return {"guardian": _read_json("guardian_evals.json"), "agent": _read_json("agent_evals.json")}


@app.post("/api/evals/guardian")
async def run_guardian_evals(request: Request, live: bool = False):
    from .evals.guardian_evals import run_suite
    rate_limit(request, 6 if live else 60, bucket="evals")
    if live and not settings.has_gemini:
        raise HTTPException(400, "Live evals need GEMINI_API_KEY.")
    return await run_suite(live=live, save=True)


# ---------- frontend ----------
static = Path(settings.static_dir)
if static.exists():
    app.mount("/", StaticFiles(directory=static, html=True), name="web")
