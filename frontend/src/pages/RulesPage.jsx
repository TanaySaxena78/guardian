import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Dot } from "../components/Icons.jsx";
import { listJoin, rs } from "../format.js";

const EXAMPLES = [
  "Ask me before anything over ₹1,500",
  "No sellers under 4.2 stars",
  "Never share my address",
  "Groceries up to ₹2,500 a week",
  "Kharcha ₹30,000 se zyada nahi",
];

function Plain({ m }) {
  const li = (kind, node, key) => (
    <li key={key}><Dot kind={kind} /><span>{node}</span></li>
  );
  const out = [
    li("ok", <>Shop on its own for orders up to <b className="num">{rs(m.ask_above)}</b> when every check passes.</>, "a"),
    li("no", <>Spend more than <b className="num">{rs(m.budget)}</b> this sale, or more than <b className="num">{rs(m.grocery_week)}</b> a week on groceries.</>, "b"),
    li("no", <>Buy from sellers rated under <b>{m.seller_floor}{"★"}</b>.</>, "c"),
    li("ask", <>Ask you before any order over <b className="num">{rs(m.ask_above)}</b>, or one split in two to dodge that.</>, "d"),
    li("ask", <>Ask you when a price is more than <b>{Math.round(m.price_tolerance * 100)}%</b> above its usual price, or a discount is measured against an inflated MRP.</>, "e"),
  ];
  if (m.ask_addons) out.push(li("ask", "Ask you before adding warranties, protection plans or subscriptions.", "f"));
  if (m.ask_irreversible) out.push(li("ask", "Ask you before anything that can't be cancelled.", "g"));
  if (m.ask_off_task) out.push(li("ask", "Ask you before buying things you didn't ask for.", "h"));
  if (m.never_share.length) out.push(li("no", `Share your ${listJoin(m.never_share)} with sellers.`, "i"));
  out.push(li("no", "Follow instructions hidden in listings, reviews or seller chats. Guardian hides them from your agent.", "j"));
  return <ul className="plain">{out}</ul>;
}

export default function RulesPage({ mandate, setMandate }) {
  const [draft, setDraft] = useState(mandate);
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(mandate), [mandate]);
  if (!draft) return <section className="page"><div className="empty">Loading your rules{"…"}</div></section>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(mandate);
  const set = (k, v) => setDraft({ ...draft, [k]: v });
  const toggleShare = (f) =>
    set("never_share", draft.never_share.includes(f) ? draft.never_share.filter((x) => x !== f) : [...draft.never_share, f]);

  async function save(next = draft) {
    setBusy(true);
    try {
      const saved = await api.saveMandate(next);
      setMandate(saved);
      setMsg({ ok: true, text: "Rules saved. Your next run uses them." });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
    setBusy(false);
  }

  async function compile(t) {
    if (!t.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.compileRule(t);
      if (r.ok) setProposal(r);
      else setMsg({ ok: false, text: r.message });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
    setBusy(false);
  }

  return (
    <section className="page">
      <div className="page-head">
        <h1>Your rules</h1>
        <p>Your agent can't argue its way past these. Guardian checks them in code before any AI model is asked anything.</p>
      </div>
      <div className="two">
        <div className="panel">
          <h2>Write a rule in your own words</h2>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); compile(text); }}>
            <label htmlFor="rule-text" className="sr-only">Rule</label>
            <input id="rule-text" className="input" value={text} onChange={(e) => setText(e.target.value)}
              placeholder={"Ask me before anything over ₹1,500"} autoComplete="off" />
            <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()}>Read rule</button>
          </form>
          <div className="presets">
            {EXAMPLES.map((x) => (
              <button key={x} type="button" className="chip dashed" onClick={() => { setText(x); compile(x); }}>{x}</button>
            ))}
          </div>
          {proposal ? (
            <div className="proposal">
              <span>Guardian read this as: <b>{proposal.summary}</b></span>
              <span className="muted small">{proposal.by === "model" ? "Read by the AI model, checked by code." : "Read by the offline rule parser."}</span>
              <div className="choices">
                <button className="btn btn-primary" onClick={async () => { await save(proposal.preview); setProposal(null); setText(""); }}>Add this rule</button>
                <button className="btn" onClick={() => setProposal(null)}>Cancel</button>
              </div>
            </div>
          ) : null}
          {msg ? <div className={`toast ${msg.ok ? "ok" : "err"}`}>{msg.text}</div> : null}

          <h2 className="mt">Limits and checks</h2>
          <div>
            <Field id="f-budget" label="Total budget for this sale" hint="Orders that go over are stopped.">
              <Money id="f-budget" value={draft.budget} onChange={(v) => set("budget", v)} step={500} />
            </Field>
            <Field id="f-grocery" label="Groceries per week" hint="Atta, dal, oil and other staples.">
              <Money id="f-grocery" value={draft.grocery_week} onChange={(v) => set("grocery_week", v)} step={100} />
            </Field>
            <Field id="f-ask" label="Ask me before any order over" hint="Smaller orders go through if nothing else is wrong.">
              <Money id="f-ask" value={draft.ask_above} onChange={(v) => set("ask_above", v)} step={100} />
            </Field>
            <Field id="f-seller" label="Lowest seller rating" hint="Lower-rated sellers are stopped.">
              <select id="f-seller" className="input" value={draft.seller_floor} onChange={(e) => set("seller_floor", +e.target.value)}>
                {[3.5, 4, 4.2, 4.5].concat([3.5, 4, 4.2, 4.5].includes(draft.seller_floor) ? [] : [draft.seller_floor]).map((v) => (
                  <option key={v} value={v}>{v.toFixed(1)}{"★"}</option>
                ))}
              </select>
            </Field>
            <Field id="f-tol" label="Ask if a price is above its usual by" hint="Compared with the last 90 days, not the MRP.">
              <select id="f-tol" className="input" value={draft.price_tolerance} onChange={(e) => set("price_tolerance", +e.target.value)}>
                {[0.02, 0.05, 0.1, 0.15].concat([0.02, 0.05, 0.1, 0.15].includes(draft.price_tolerance) ? [] : [draft.price_tolerance]).map((v) => (
                  <option key={v} value={v}>{Math.round(v * 100)}%</option>
                ))}
              </select>
            </Field>
            <Toggle id="f-addons" label="Ask before plans and subscriptions" hint="Warranties, protection plans, auto-renewals." value={draft.ask_addons} onChange={(v) => set("ask_addons", v)} />
            <Toggle id="f-irrev" label="Ask before things that can't be cancelled" hint="Gift cards, tickets, perishables." value={draft.ask_irreversible} onChange={(v) => set("ask_irreversible", v)} />
            <Toggle id="f-offtask" label="Ask before items I didn't ask for" hint="Stops your agent from deciding what you want." value={draft.ask_off_task} onChange={(v) => set("ask_off_task", v)} />
            <div className="field">
              <span className="lbl">Never share with sellers<small>Requests for these are stopped.</small></span>
              <div className="checks">
                {["phone", "email", "address"].map((f) => (
                  <label key={f} className={`chip-check ${draft.never_share.includes(f) ? "on" : ""}`}>
                    <input type="checkbox" checked={draft.never_share.includes(f)} onChange={() => toggleShare(f)} />
                    {f[0].toUpperCase() + f.slice(1)}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="choices">
            <button className="btn btn-primary" disabled={!dirty || busy} onClick={() => save()}>Save rules</button>
            <button className="btn" disabled={!dirty || busy} onClick={() => setDraft(mandate)}>Discard changes</button>
            <button className="btn btn-quiet" disabled={busy} onClick={async () => { const m = await api.resetMandate(); setMandate(m); setMsg({ ok: true, text: "Rules reset to the defaults." }); }}>Reset to defaults</button>
          </div>
        </div>
        <div className="panel">
          <h2>What your agent can and can't do</h2>
          <Plain m={draft} />
          <details>
            <summary>See the rules as Guardian stores them</summary>
            <pre>{JSON.stringify(draft, null, 2)}</pre>
          </details>
        </div>
      </div>
    </section>
  );
}

function Field({ id, label, hint, children }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}<small>{hint}</small></label>
      {children}
    </div>
  );
}

function Money({ id, value, onChange, step }) {
  return (
    <div className="input-money">
      <span>{"₹"}</span>
      <input id={id} className="input num" type="number" min="0" step={step} value={value} onChange={(e) => onChange(Math.max(0, +e.target.value || 0))} />
    </div>
  );
}

function Toggle({ id, label, hint, value, onChange }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}<small>{hint}</small></label>
      <div className="switch"><input id={id} type="checkbox" role="switch" checked={value} onChange={(e) => onChange(e.target.checked)} /></div>
    </div>
  );
}
