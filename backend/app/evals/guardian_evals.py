"""Guardian eval suite: runs the golden test set through the real pipeline.

Offline (default): rules, integrity checks and the pattern scanner. No API calls.
Live (--live): also Prompt Guard 2 (Groq) and the Gemini judge.

    cd backend
    python -m app.evals.guardian_evals            # offline
    python -m app.evals.guardian_evals --live     # uses your API keys
"""
import argparse
import asyncio
import json
import time
from pathlib import Path

from ..config import settings
from ..guardian import pipeline, scanner
from ..models import Action, Mandate
from ..store import catalog

GOLDEN = Path(__file__).with_name("golden.json")


def _fill(p: dict) -> dict:
    out = {"seller": {"id": "s_test", "name": "Test Seller", "rating": 4.5}, "stock": 500, "tags": [],
           "history": [], "listing": "Standard listing.", "reviews": []}
    out.update(p)
    out.setdefault("typical", p["price"])
    return out


def _pct(a: int, b: int) -> float:
    return round(a / b, 4) if b else 0.0


async def _scanner_metrics(items: list[dict], live: bool) -> dict:
    rows = []
    for it in items:
        res = await scanner.scan(it["text"], use_model=live)
        rows.append({"text": it["text"], "injection": it["injection"],
                     "patterns": scanner.heuristic(it["text"])["flagged"],
                     "model": (res["model_score"] is not None and res["model_score"] >= settings.prompt_guard_threshold) if live else None,
                     "model_score": res["model_score"], "combined": res["flagged"]})

    def pr(key):
        tp = sum(1 for r in rows if r[key] and r["injection"])
        fp = sum(1 for r in rows if r[key] and not r["injection"])
        fn = sum(1 for r in rows if not r[key] and r["injection"])
        tn = sum(1 for r in rows if not r[key] and not r["injection"])
        return {"tp": tp, "fp": fp, "fn": fn, "tn": tn,
                "precision": _pct(tp, tp + fp), "recall": _pct(tp, tp + fn), "false_positive_rate": _pct(fp, fp + tn)}

    out = {"rows": rows, "patterns": pr("patterns"), "combined": pr("combined"),
           "unscored": sum(1 for r in rows if live and r["model_score"] is None)}
    if live and any(r["model_score"] is not None for r in rows):
        out["model"] = pr("model")
    return out


async def run_suite(live: bool = False, save: bool = True, progress: bool = False) -> dict:
    g = json.loads(GOLDEN.read_text(encoding="utf-8"))
    test_products = [_fill(p) for p in g["test_products"]]
    mandate = Mandate()
    results = []
    t0 = time.time()

    with catalog.extra_products(test_products):
        for n, c in enumerate(g["cases"], 1):
            if progress:
                print(f"  case {n}/{len(g['cases'])}: {c['desc']}", flush=True)
            ctx = pipeline.RunContext(task=c.get("task", g["default_task"]), mandate=mandate)
            cx = c.get("ctx", {})
            ctx.spent = cx.get("spent", 0)
            ctx.grocery_spent = cx.get("grocery_spent", 0)
            ctx.recent = list(cx.get("recent", []))
            for pid in c.get("pages_viewed", []):
                page = catalog.page(catalog.get(pid))
                for f in await scanner.scan_page(page, use_model=live):
                    ctx.flagged.append({"product_id": pid, "field": f["field"], "text": f["text"], "hits": f["hits"]})
            action = Action(**{"qty": 1, **c["action"]})
            res = await pipeline.check(action, ctx, use_judge=live)
            judge_ok = None
            if res.judge and "aligned_with_task" in res.judge and "expect_in_task" in c:
                judge_ok = res.judge["aligned_with_task"] == c["expect_in_task"]
            results.append({
                "id": c["id"], "group": c["group"], "desc": c["desc"], "expect": c["expect"], "got": res.verdict,
                "pass": res.verdict == c["expect"], "amount": res.amount,
                "codes": [r.code for r in res.reasons], "top_reason": res.reasons[0].text if res.reasons else "",
                "judge": res.judge, "judge_agrees": judge_ok, "latency_ms": res.latency_ms,
            })
        scan = await _scanner_metrics(g["scanner_set"], live)

    harmful = [r for r in results if r["expect"] != "allow"]
    safe = [r for r in results if r["expect"] == "allow"]
    inj = [r for r in results if r["group"] == "injection"]
    matrix = {e: {v: 0 for v in ("allow", "ask", "block")} for e in ("allow", "ask", "block")}
    for r in results:
        matrix[r["expect"]][r["got"]] += 1
    judged = [r for r in results if r["judge_agrees"] is not None]

    summary = {
        "total": len(results),
        "exact": sum(r["pass"] for r in results),
        "harmful": len(harmful),
        "let_through": sum(r["got"] == "allow" for r in harmful),
        "safe": len(safe),
        "wrongly_stopped": sum(r["got"] != "allow" for r in safe),
        "asks": sum(r["got"] == "ask" for r in results),
        "injections": len(inj),
        "injections_blocked": sum(r["got"] == "block" for r in inj),
        "injections_paused": sum(r["got"] == "ask" for r in inj),
        "money_protected": sum(r["amount"] for r in harmful if r["got"] != "allow"),
        "judge_cases": len(judged),
        "judge_errors": sum(1 for r in results if r["judge"] and "error" in r["judge"]),
        "judge_agreement": _pct(sum(r["judge_agrees"] for r in judged), len(judged)) if judged else None,
        "avg_latency_ms": round(sum(r["latency_ms"] for r in results) / max(1, len(results))),
    }
    out = {
        "mode": "live" if live else "offline",
        "ran_at": time.strftime("%Y-%m-%d %H:%M", time.localtime()),
        "seconds": round(time.time() - t0, 1),
        "models": {"judge": settings.judge_model if live else None,
                   "prompt_guard": settings.prompt_guard_model if live and settings.has_groq else None},
        "groups": g["groups"], "summary": summary, "matrix": matrix, "results": results, "scanner": scan,
    }
    if save:
        (Path(settings.data_dir) / "guardian_evals.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    return out


def _print(out: dict):
    s = out["summary"]
    print(f"\nGuardian evals ({out['mode']}), {s['total']} cases")
    print(f"  Right verdict:            {s['exact']}/{s['total']}")
    print(f"  Harmful let through:      {s['let_through']}/{s['harmful']}")
    print(f"  Safe wrongly stopped:     {s['wrongly_stopped']}/{s['safe']}")
    print(f"  Injections blocked:       {s['injections_blocked']}/{s['injections']} (paused: {s['injections_paused']})")
    if s["judge_agreement"] is not None:
        print(f"  Judge agrees with labels: {s['judge_agreement']:.0%} of {s['judge_cases']}")
    sc = out["scanner"]
    print(f"  Scanner, patterns only:   recall {sc['patterns']['recall']:.0%}, false positives {sc['patterns']['fp']}")
    if s.get("judge_errors"):
        print(f"  Judge calls that failed:  {s['judge_errors']} (rate limit or network; those cases used keyword matching)")
    if "model" in sc:
        print(f"  Scanner, Prompt Guard:    recall {sc['model']['recall']:.0%}, false positives {sc['model']['fp']}")
        if sc.get("unscored"):
            print(f"    ({sc['unscored']} texts got no score because the Groq call failed)")
        print("    Prompt Guard scores on the attack texts:")
        for r in sc["rows"]:
            if r["injection"]:
                score = "no score" if r["model_score"] is None else f"{r['model_score']:.2f}"
                print(f"      {score:>8}  {r['text'][:70]}")
    print(f"  Scanner, combined:        recall {sc['combined']['recall']:.0%}, false positives {sc['combined']['fp']}")
    misses = [r for r in out["results"] if not r["pass"]]
    if misses:
        print("  Misses:")
        for r in misses:
            print(f"    {r['id']:4} expected {r['expect']:5} got {r['got']:5}  {r['desc']}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true", help="use Gemini judge and Prompt Guard")
    args = ap.parse_args()
    _print(asyncio.run(run_suite(live=args.live, progress=args.live)))