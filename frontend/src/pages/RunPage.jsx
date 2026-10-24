import { useEffect, useRef, useState } from "react";
import ActionCard from "../components/ActionCard.jsx";
import { BrowseRow, MessageRow } from "../components/BrowseRow.jsx";
import Wallet from "../components/Wallet.jsx";

const PRESETS = [
  {
    label: "Festive sale",
    task: "Festive sale: restock weekly groceries, get a 5 L pressure cooker, a phone under ₹20,000 for Mom, and a ₹5,000 Diwali gift card.",
  },
  { label: "Just groceries", task: "Restock this week's groceries: atta, sunflower oil and toor dal." },
  { label: "Phone for Mom", task: "Find and buy a good 5G phone under ₹20,000 for Mom. She needs a big battery." },
];

export default function RunPage({ run, health, mandate }) {
  const { state, start, stop, decide } = run;
  const [task, setTask] = useState(PRESETS[0].task);
  const [mode, setMode] = useState("protected");
  const [agent, setAgent] = useState("scripted");
  const feedEnd = useRef(null);

  useEffect(() => {
    if (health?.gemini) setAgent("gemini");
  }, [health?.gemini]);

  const busy = state.status === "starting" || state.status === "running";
  const lastLen = useRef(0);
  useEffect(() => {
    if (state.items.length > lastLen.current && busy) {
      feedEnd.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "end" });
    }
    lastLen.current = state.items.length;
  }, [state.items.length, busy]);

  const waiting = state.items.filter((i) => i.kind === "action" && i.awaiting).length;
  const leaked = state.items.filter((i) => i.kind === "browse" && i.flagged?.length && !i.hidden_from_agent)
    .reduce((n, i) => n + i.flagged.length, 0);
  let actionIndex = 0;

  return (
    <section className="page">
      <div className="composer-card">
        <label htmlFor="task" className="task-label">Task for your agent</label>
        <textarea id="task" className="task-input" rows={2} value={task} onChange={(e) => setTask(e.target.value)} disabled={busy} />
        <div className="presets" role="group" aria-label="Example tasks">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className={`chip ${task === p.task ? "on" : ""}`} onClick={() => setTask(p.task)} disabled={busy}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="controls">
          <div className="segmented" role="radiogroup" aria-label="Guardian">
            <button role="radio" aria-checked={mode === "protected"} className={mode === "protected" ? "on" : ""} onClick={() => setMode("protected")} disabled={busy}>
              Guardian on
            </button>
            <button role="radio" aria-checked={mode === "unprotected"} className={mode === "unprotected" ? "on" : ""} onClick={() => setMode("unprotected")} disabled={busy}>
              Guardian off
            </button>
          </div>
          <label className="select-wrap">
            <span className="sr-only">Agent</span>
            <select value={agent} onChange={(e) => setAgent(e.target.value)} disabled={busy}>
              <option value="gemini" disabled={!health?.gemini}>
                Gemini agent{health?.gemini ? ` (${health.agent_model})` : " (add a key to use)"}
              </option>
              <option value="scripted">Demo agent, no key needed</option>
            </select>
          </label>
          {busy ? (
            <button className="btn" onClick={stop}>Stop the agent</button>
          ) : (
            <button className="btn btn-primary" onClick={() => start(task, mode, agent)} disabled={task.trim().length < 3}>
              {state.status === "idle" ? "Start the agent" : "Run again"}
            </button>
          )}
          <span className="status-line" aria-live="polite">
            {state.status === "starting" && "Starting…"}
            {state.status === "running" && (waiting ? `Your agent is waiting for you on ${waiting} action${waiting === 1 ? "" : "s"}.` : "Your agent is shopping.")}
            {state.status === "finished" && "Run finished. See Receipts for what was bought and why."}
            {state.status === "stopped" && "You stopped the run."}
            {state.status === "error" && "The run stopped with an error."}
          </span>
        </div>
        {state.errors.map((e, i) => <div key={i} className="toast err">{e}</div>)}
      </div>

      <div className="run">
        <ol className="feed">
          {state.items.length === 0 ? (
            <li className="empty">
              <strong>Your agent hasn't started yet</strong>
              <span>Pick a task and press Start. Every search, page and purchase shows up here, and Guardian checks each purchase before it happens. Try it once with Guardian off to see what slips through.</span>
            </li>
          ) : (
            state.items.map((it) => {
              if (it.kind === "msg") return <MessageRow key={it.seq} item={it} />;
              if (it.kind === "browse") return <BrowseRow key={it.seq} item={it} />;
              actionIndex += 1;
              return <ActionCard key={it.step_id} item={it} index={actionIndex} onDecide={decide} />;
            })
          )}
          {state.summary && state.status === "finished" ? (
            <li className="row row-msg done"><span><b>Agent's summary:</b> {state.summary}</span></li>
          ) : null}
          <li ref={feedEnd} aria-hidden="true" className="feed-end" />
        </ol>
        <Wallet wallet={state.wallet} mode={state.runId ? state.mode : mode} mandate={mandate} status={state.status} leaked={leaked} />
      </div>
    </section>
  );
}
