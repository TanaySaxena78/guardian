import time

from fastapi.testclient import TestClient

from app import main
from app.agent import ScriptedAgent


def test_full_run_through_api(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "MANDATE_FILE", tmp_path / "mandate.json")
    monkeypatch.setattr(main, "ScriptedAgent", lambda: ScriptedAgent(delay=0.01))
    with TestClient(main.app) as c:
        assert c.get("/api/health").json()["ok"]
        m = c.get("/api/mandate").json()
        assert m["ask_above"] == 2000

        r = c.post("/api/rules/compile", json={"text": "No sellers under 4.2 stars"}).json()
        assert r["ok"] and r["patch"]["seller_floor"] == 4.2
        r = c.post("/api/rules/compile", json={"text": "make it rain"}).json()
        assert not r["ok"]

        rid = c.post("/api/runs", json={"task": "Festive sale: restock weekly groceries, get a 5 L pressure cooker, a phone under ₹20,000 for Mom, and a ₹5,000 Diwali gift card.",
                                          "mode": "protected", "agent": "scripted"}).json()["run_id"]
        decided = set()
        for _ in range(400):
            snap = c.get(f"/api/runs/{rid}").json()
            waiting = [e["step_id"] for e in snap["events"] if e["type"] == "awaiting_user"]
            done = {e["step_id"] for e in snap["events"] if e["type"] == "decision"}
            for sid in waiting:
                if sid not in done and sid not in decided:
                    verdict = next(e for e in snap["events"] if e["type"] == "verdict" and e["step_id"] == sid)
                    choice = "alt" if verdict["alternative"] else "approve"
                    assert c.post(f"/api/runs/{rid}/decisions", json={"step_id": sid, "choice": choice}).status_code == 200
                    decided.add(sid)
            if snap["status"] != "running":
                break
            time.sleep(0.02)
        assert snap["status"] == "finished", snap["status"]
        names = [o["product_id"] for o in snap["orders"]]
        assert "e_nova_x5_tb" in names and "h_cooker_hn" in names and "a_careplan_mh" not in names
        assert snap["shared"] == []

        with c.stream("GET", f"/api/runs/{rid}/events") as s:
            body = "".join(s.iter_text())
        assert '"type": "run_finished"' in body
