import { FIELD_NAME, STAMP, WOULD, clock, rs } from "../format.js";

export default function ReceiptsPage({ state, goRun }) {
  const actions = state.items.filter((i) => i.kind === "action" && i.verdict);
  const total = state.orders.reduce((s, o) => s + o.amount, 0);
  const off = state.mode === "unprotected";

  return (
    <section className="page">
      <div className="page-head">
        <h1>Receipts</h1>
        <p>Every order your agent placed in this run, and why it was allowed through.</p>
      </div>

      {state.orders.length === 0 && state.shared.length === 0 ? (
        <div className="empty">
          <strong>No orders yet</strong>
          <span>Start your agent on the Live run tab. Every order it places shows up here with the reason it went through.</span>
          <div><button className="btn btn-primary" onClick={goRun}>Go to Live run</button></div>
        </div>
      ) : (
        <div className="receipt">
          {state.orders.map((o) => (
            <div className="receipt-row" key={o.id}>
              <div>
                <h3>{o.qty > 1 ? `${o.qty} × ` : ""}{o.name}</h3>
                <span className="seller">{o.seller}, {clock(o.t)}</span>
              </div>
              <span className="price num">{rs(o.amount)}</span>
              <div className="why"><span><b>Why it went through:</b> {o.why}</span></div>
            </div>
          ))}
          {state.shared.map((s, i) => (
            <div className="receipt-row" key={"s" + i}>
              <div><h3>Your {FIELD_NAME[s.field] || s.field} was shared with {s.with}</h3></div>
              <span className="pill block">Data shared</span>
            </div>
          ))}
          <div className="total-row">
            <span>Total charged{off ? " with Guardian off" : ""}</span>
            <span className="num">{rs(total)}</span>
          </div>
        </div>
      )}

      {actions.length ? (
        <>
          <div className="page-head"><h2 className="h2">Everything Guardian decided</h2></div>
          <div className="scroll">
            <table className="log">
              <thead><tr><th>Time</th><th>Action</th><th>Guardian</th><th>You</th><th>Reason codes</th></tr></thead>
              <tbody>
                {actions.map((a) => {
                  const p = a.proposal;
                  const what = p.kind === "share" ? `Share ${p.field} with ${p.seller_name}` : `${p.qty > 1 ? p.qty + " × " : ""}${p.product?.name}`;
                  return (
                    <tr key={a.step_id}>
                      <td className="num">{clock(a.t)}</td>
                      <td>{what}</td>
                      <td><span className={`pill ${a.verdict.verdict}`}>{a.verdict.enforced ? STAMP[a.verdict.verdict] : WOULD[a.verdict.verdict]}</span></td>
                      <td>{a.decision === "approve" ? "Approved" : a.decision === "alt" ? "Picked better listing" : a.decision === "skip" ? "Said no" : ""}</td>
                      <td className="row-detail">{a.verdict.reasons.map((r) => r.code).join(", ") || "ALL_CHECKS_PASSED"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
