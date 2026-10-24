import { rs } from "../format.js";

export default function Wallet({ wallet, mode, mandate, status, leaked = 0 }) {
  const w = wallet || { spent: 0, grocery_spent: 0, kept: 0, counts: { allow: 0, ask: 0, block: 0 }, hidden: 0,
    budget: mandate?.budget || 0, grocery_week: mandate?.grocery_week || 0 };
  const off = mode === "unprotected";
  const spentPct = w.budget ? Math.min(100, (w.spent / w.budget) * 100) : 0;
  const grocPct = w.grocery_week ? Math.min(100, (w.grocery_spent / w.grocery_week) * 100) : 0;
  return (
    <aside className="wallet" aria-label="Run summary">
      {off ? (
        <div className="off-note">
          <strong>Guardian is off</strong>
          <p>It's only watching. Everything your agent tries goes through. Each card shows what Guardian would have done.</p>
        </div>
      ) : (
        <div className="kept">
          <h2>Kept in your wallet</h2>
          <div className="big num">{rs(w.kept)}</div>
          <p>Money Guardian stopped your agent from spending on things you didn't want.</p>
        </div>
      )}
      <div className="hr" />
      <div className="meter">
        <div className="meter-row"><span>Spent this sale</span><b className="num">{rs(w.spent)} of {rs(w.budget)}</b></div>
        <div className="meter-track"><div className={`meter-fill ${w.spent > w.budget ? "over" : ""}`} style={{ width: spentPct + "%" }} /></div>
      </div>
      <div className="meter">
        <div className="meter-row"><span>Groceries this week</span><b className="num">{rs(w.grocery_spent)} of {rs(w.grocery_week)}</b></div>
        <div className="meter-track"><div className={`meter-fill ${w.grocery_spent > w.grocery_week ? "over" : ""}`} style={{ width: grocPct + "%" }} /></div>
      </div>
      <div className="tally">
        <div className="t-allow"><b className="num">{w.counts.allow}</b><span>{off ? "Would pass" : "Went through"}</span></div>
        <div className="t-ask"><b className="num">{w.counts.ask}</b><span>{off ? "Would ask" : "Asked you"}</span></div>
        <div className="t-block"><b className="num">{w.counts.block}</b><span>{off ? "Would stop" : "Stopped"}</span></div>
      </div>
      <div className="meter-row small muted">
        <span>{off ? "Hidden instructions your agent read" : "Hidden instructions kept from your agent"}</span>
        <b className="num" style={{ color: "var(--ink)", fontWeight: 500 }}>{off ? leaked : w.hidden}</b>
      </div>
      {status === "running" ? <div className="live"><span className="pulse" />Your agent is working</div> : null}
      <p className="mock-note">Mock store with invented sellers. Nothing is really charged.</p>
    </aside>
  );
}