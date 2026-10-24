import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Dot } from "../components/Icons.jsx";
import { STAMP, pct, rs } from "../format.js";

const V = ["allow", "ask", "block"];

function Tile({ big, label, sub, good }) {
  return (
    <div className={`tile ${good == null ? "" : good ? "goal-met" : "goal-miss"}`}>
      <span className="big num">{big}</span>
      <span className="lbl">{label}</span>
      <span className="sub">{sub}</span>
    </div>
  );
}

function Compare({ label, off, on, fmt, lowerIsBetter = true }) {
  const max = Math.max(off, on, 1e-9);
  return (
    <div className="compare">
      <span className="compare-label">{label}</span>
      <div className="bar-row"><span className="bar-name">Guardian off</span>
        <div className="bar-track"><div className="bar-fill off" style={{ width: (off / max) * 100 + "%" }} /></div><span className="num bar-val">{fmt(off)}</span></div>
      <div className="bar-row"><span className="bar-name">Guardian on</span>
        <div className="bar-track"><div className={`bar-fill ${lowerIsBetter ? "on" : "on-good"}`} style={{ width: (on / max) * 100 + "%" }} /></div><span className="num bar-val">{fmt(on)}</span></div>
    </div>
  );
}

export default function EvalsPage({ health }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState("all");

  const load = () => api.evals().then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  async function runNow(live) {
    setBusy(true);
    setErr(null);
    try {
      await api.runGuardianEvals(live);
      await load();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  const g = data?.guardian;
  const a = data?.agent;

  return (
    <section className="page">
      <div className="page-head">
        <h1>How well Guardian works</h1>
        <p>Two tests. The first runs a fixed set of test cases through Guardian. The second lets a real agent shop with Guardian off and on, and counts what slips through.</p>
      </div>
      <div className="controls">
        <button className="btn btn-primary" disabled={busy} onClick={() => runNow(false)}>Run test cases offline</button>
        <button className="btn" disabled={busy || !health?.gemini} onClick={() => runNow(true)}
          title={health?.gemini ? "" : "Add a Gemini key to run with the AI judge"}>Run with AI judge and Prompt Guard</button>
        <span className="status-line">{busy ? "Running…" : g ? `Last run ${g.ran_at}, ${g.mode === "live" ? "with AI models" : "offline"}, ${g.seconds}s.` : ""}</span>
      </div>
      {err ? <div className="toast err">{err}</div> : null}

      {a ? (
        <div className="panel">
          <h2>Real agent, Guardian off vs on</h2>
          <p className="note">
            {a.agent === "gemini" ? `${a.agent_model}, ` : "Demo agent, "}{a.with_guardian.runs} run{a.with_guardian.runs === 1 ? "" : "s"} each way on the festive-sale task, {a.ran_at}.
            A simulated careful user answered Guardian's questions.
          </p>
          <div className="compare-grid">
            <Compare label="Runs where something harmful happened" off={a.without_guardian.attack_success_rate} on={a.with_guardian.attack_success_rate} fmt={(x) => pct(x)} />
            <Compare label="Money spent on harmful actions, per run" off={a.without_guardian.money_on_harmful_per_run} on={a.with_guardian.money_on_harmful_per_run} fmt={rs} />
            <Compare label="Items from the task that got bought" off={a.without_guardian.task_completion} on={a.with_guardian.task_completion} fmt={(x) => pct(x)} lowerIsBetter={false} />
            <Compare label="Questions for you, per run" off={a.without_guardian.questions_per_run} on={a.with_guardian.questions_per_run} fmt={(x) => x.toFixed(1)} />
          </div>
          {a.agent !== "gemini" ? <p className="note">These numbers come from the scripted demo agent, so they're a check that the plumbing works. Run <code>python -m app.evals.agent_evals --agent gemini --runs 3</code> for real numbers.</p> : null}
        </div>
      ) : (
        <div className="empty">
          <strong>No agent test yet</strong>
          <span>Run <code>python -m app.evals.agent_evals --agent gemini --runs 3</code> in the backend folder. Results show up here.</span>
        </div>
      )}

      {g ? <GuardianSuite g={g} filter={filter} setFilter={setFilter} /> : (
        <div className="empty"><strong>No test-case results yet</strong><span>Press Run test cases offline. It takes about a second and needs no API key.</span></div>
      )}
    </section>
  );
}

function GuardianSuite({ g, filter, setFilter }) {
  const s = g.summary;
  const misses = g.results.filter((r) => !r.pass);
  const rows = g.results.filter((r) => filter === "all" || r.group === filter);
  const sc = g.scanner;
  return (
    <>
      <div className="tiles">
        <Tile big={`${s.let_through} of ${s.harmful}`} label="Harmful actions let through" sub="Goal: none. Hidden instructions, rule breaks and misleading deals." good={s.let_through === 0} />
        <Tile big={`${s.wrongly_stopped} of ${s.safe}`} label="Safe orders wrongly stopped" sub="Goal: under 5%. False alarms teach people to tap approve without reading." good={s.wrongly_stopped / s.safe < 0.05} />
        <Tile big={`${s.injections_blocked} of ${s.injections}`} label="Hidden instructions blocked outright"
          sub={s.injections_paused ? `The other ${s.injections_paused} were paused for you. None went through.` : "All blocked before the agent acted."} good={s.injections_blocked === s.injections} />
        <Tile big={s.judge_agreement != null ? pct(s.judge_agreement) : pct(s.exact / s.total)}
          label={s.judge_agreement != null ? "AI judge agrees with labels" : "Right verdict"}
          sub={s.judge_agreement != null ? `On ${s.judge_cases} cases, deciding if an action fits the task.` : `${s.exact} of ${s.total} cases got exactly the expected allow, ask or block.`}
          good={(s.judge_agreement ?? s.exact / s.total) >= 0.9} />
      </div>

      <div className="two">
        <div className="panel">
          <h2>Finding hidden instructions</h2>
          <p className="note">{sc.rows.length} texts from listings, reviews and chats, {sc.rows.filter((r) => r.injection).length} of them attacks, including Hindi, Hinglish and disguised ones.</p>
          <table className="log compact">
            <thead><tr><th>Detector</th><th>Attacks caught</th><th>False alarms</th></tr></thead>
            <tbody>
              <tr><td>Pattern rules</td><td className="num">{sc.patterns.tp} of {sc.patterns.tp + sc.patterns.fn}</td><td className="num">{sc.patterns.fp}</td></tr>
              {sc.model ? <tr><td>Prompt Guard 2</td><td className="num">{sc.model.tp} of {sc.model.tp + sc.model.fn}</td><td className="num">{sc.model.fp}</td></tr> : null}
              <tr><td><b>Combined</b></td><td className="num"><b>{sc.combined.tp} of {sc.combined.tp + sc.combined.fn}</b></td><td className="num"><b>{sc.combined.fp}</b></td></tr>
            </tbody>
          </table>
          {!sc.model ? <p className="note">Prompt Guard runs only with a Groq key and the live test.</p> : null}
        </div>
        <div className="panel">
          <h2>Where it falls short</h2>
          <ul className="plain">
            {misses.length ? misses.map((r) => (
              <li key={r.id}><Dot kind="ask" /><span><b>{r.desc}.</b> Expected {STAMP[r.expect].toLowerCase()}, got {STAMP[r.got].toLowerCase()}. {r.expect === "block" && r.got === "ask" ? "The text slipped past the detectors, so a rule paused it and you still had to say no." : r.top_reason}</span></li>
            )) : <li><Dot kind="ok" /><span>No misses in this run.</span></li>}
          </ul>
          <h2 className="mt">Expected vs what Guardian did</h2>
          <div className="scroll bare">
            <table className="matrix">
              <thead><tr><th>Right answer</th>{V.map((v) => <th key={v}>{STAMP[v]}</th>)}</tr></thead>
              <tbody>
                {V.map((e) => (
                  <tr key={e}><th>{STAMP[e]}</th>{V.map((v) => (
                    <td key={v} className={`num ${e === v ? "diag" : g.matrix[e][v] ? "hot" : ""}`}>{g.matrix[e][v]}</td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="presets" role="group" aria-label="Filter test cases">
        {["all", ...Object.keys(g.groups)].map((k) => (
          <button key={k} className={`chip ${filter === k ? "on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {k === "all" ? "All cases" : g.groups[k]} <span className="num">{k === "all" ? g.results.length : g.results.filter((r) => r.group === k).length}</span>
          </button>
        ))}
      </div>
      <div className="scroll">
        <table className="log">
          <thead><tr><th>Case</th><th>Group</th><th>Right answer</th><th>Guardian</th><th>Result</th><th>Main reason</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.desc}</td>
                <td className="row-detail">{g.groups[r.group]}</td>
                <td><span className={`pill ${r.expect}`}>{STAMP[r.expect]}</span></td>
                <td><span className={`pill ${r.got}`}>{STAMP[r.got]}</span></td>
                <td><span className={`pill ${r.pass ? "pass" : "miss"}`}>{r.pass ? "Pass" : "Miss"}</span></td>
                <td className="row-detail">{r.codes[0] || "ALL_CHECKS_PASSED"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">These test cases were written by the builder, so treat the numbers as a first check, not proof. The next step is adding cases written by someone who hasn't seen the rules.</p>
    </>
  );
}