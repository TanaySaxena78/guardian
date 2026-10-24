import { useEffect, useState } from "react";
import { api } from "./api.js";
import EvalsPage from "./pages/EvalsPage.jsx";
import ReceiptsPage from "./pages/ReceiptsPage.jsx";
import RulesPage from "./pages/RulesPage.jsx";
import RunPage from "./pages/RunPage.jsx";
import { personAvatar } from "./site/avatars.js";
import { Logo } from "./site/widgets.jsx";
import { useRun } from "./useRun.js";

const TABS = [
  { id: "run", label: "Live run" },
  { id: "rules", label: "Your rules" },
  { id: "receipts", label: "Receipts" },
  { id: "evals", label: "Evals" },
];

export default function AppShell({ tab, go }) {
  const [health, setHealth] = useState(null);
  const [mandate, setMandate] = useState(null);
  const [offline, setOffline] = useState(false);
  const run = useRun();

  useEffect(() => {
    api.health().then(setHealth).catch(() => setOffline(true));
    api.mandate().then(setMandate).catch(() => {});
  }, []);

  useEffect(() => { window.scrollTo(0, 0); }, [tab]);

  const waiting = run.state.items.filter((i) => i.kind === "action" && i.awaiting).length;
  const guardOn = !run.state.runId || run.state.mode === "protected";

  return (
    <div className="app">
      <header className="bar">
        <div className="bar-inner">
          <a className="brand" href="#/" aria-label="Guardian home">
            <Logo size={28} />
            <span className="brand-name">guardian</span>
          </a>
          <nav className="tabs" role="tablist" aria-label="Sections">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => go(`#/app/${t.id}`)}>
                {t.label}
                {t.id === "run" && waiting ? <span className="badge num">{waiting}</span> : null}
                {t.id === "receipts" && run.state.orders.length ? <span className="count num">{run.state.orders.length}</span> : null}
              </button>
            ))}
          </nav>
          <span className={`status ${guardOn ? "" : "off"}`}>
            <span className="dot" />
            {guardOn ? "Guardian on" : "Guardian off"}
          </span>
          <span className="who" title="Asha, the demo shopper">
            <img src={personAvatar("Asha", "FFD86B")} alt="" width="30" height="30" />
            <span>Asha</span>
          </span>
        </div>
      </header>
      <main className="wrap">
        {offline ? (
          <div className="toast err">Can't reach the Guardian server. Start the backend with <code>uvicorn app.main:app --reload</code> in the backend folder.</div>
        ) : null}
        {tab === "run" && <RunPage run={run} health={health} mandate={mandate} />}
        {tab === "rules" && <RulesPage mandate={mandate} setMandate={setMandate} />}
        {tab === "receipts" && <ReceiptsPage state={run.state} goRun={() => go("#/app/run")} />}
        {tab === "evals" && <EvalsPage health={health} />}
      </main>
    </div>
  );
}