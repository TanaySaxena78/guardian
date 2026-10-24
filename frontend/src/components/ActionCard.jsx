import { AgentIcon, EyeOff } from "./Icons.jsx";
import PriceChart from "./PriceChart.jsx";
import { sellerAvatar } from "../site/avatars.js";
import { FIELD_NAME, STAMP, WOULD, clock, rs } from "../format.js";

function title(p) {
  if (p.kind === "share") return `Share your ${FIELD_NAME[p.field] || p.field} with ${p.seller_name}`;
  if (p.kind === "addon") return `Add ${p.product?.name || "an add-on"}`;
  return (p.qty > 1 ? `${p.qty} × ` : "") + (p.product?.name || "Unknown item");
}

function summaryLine(v, enforced) {
  if (!enforced) {
    if (v.verdict === "allow") return "Guardian is off. This would have passed every check.";
    return "Guardian is off, so this went through anyway.";
  }
  if (v.verdict === "allow") return "All checks passed.";
  if (v.verdict === "ask") return "Paused. Your agent needs your OK.";
  return "Stopped before anything happened.";
}

export default function ActionCard({ item, index, onDecide }) {
  const p = item.proposal;
  const v = item.verdict;
  const price = p.product && p.kind !== "share" ? p.product.price * (p.qty || 1) : null;
  const enforced = v ? v.enforced : true;
  const band = v ? (enforced ? v.verdict : "off") : null;
  const injected = v?.reasons?.find((r) => r.code === "INJECTED_SOURCE");
  const showChart = v?.reasons?.some((r) => r.code === "ABOVE_TYPICAL" || r.code === "FRAMED_DISCOUNT");

  // Allowed actions collapse to one quiet line, so the feed draws the eye to what needed Guardian.
  if (v && v.verdict === "allow") {
    return (
      <li className="step compact" id={`step-${item.step_id}`}>
        <span className={`stamp ${enforced ? "" : "off"}`}>{enforced ? STAMP.allow : WOULD.allow}</span>
        <h3>{title(p)}</h3>
        {price ? <span className="price num">{rs(price)}</span> : <span />}
        <span className="why-line">{v.passes?.[0] || "All checks passed."}{p.reason ? ` Your agent: ${p.reason}` : ""}</span>
      </li>
    );
  }

  return (
    <li className="step" id={`step-${item.step_id}`}>
      <div className="step-top">
        <div className="step-meta">
          <span>Action {index}</span>
          <span className="num">{clock(item.t)}</span>
        </div>
        <div className="step-title">
          <h3>{title(p)}</h3>
          {price ? <span className="price num">{rs(price)}</span> : null}
        </div>
        {p.product ? (
          <span className="seller">
            <img className="seller-av" src={sellerAvatar(p.product.seller.name)} alt="" width="20" height="20" />
            Sold by {p.product.seller.name}, rated {p.product.seller.rating}{"★"}
            {p.product.sponsored ? ", sponsored listing" : ""}
          </span>
        ) : null}
        {p.reason ? (
          <p className="agent-note">
            <AgentIcon />
            <span><b>Your agent:</b> {p.reason}</span>
          </p>
        ) : null}
      </div>

      {!v ? (
        <div className="checking"><span className="pulse" />Guardian is checking this against your rules and the store's data</div>
      ) : (
        <div className={`verdict ${band}`}>
          <div className="verdict-head">
            <span className="stamp">{enforced ? STAMP[v.verdict] : WOULD[v.verdict]}</span>
            <span className="verdict-sum">{summaryLine(v, enforced)}</span>
            {v.latency_ms ? <span className="latency num">{v.latency_ms} ms</span> : null}
          </div>

          {v.verdict === "allow" && v.passes?.length ? (
            <ul className="reasons">{v.passes.map((t, i) => <li key={i}>{t}</li>)}</ul>
          ) : (
            <ul className="reasons">
              {v.reasons.map((r, i) => (
                <li key={i}>
                  <span>
                    {r.text}
                    <span className="code">{r.code}{r.source === "judge" ? ", AI judge" : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {showChart ? <PriceChart evidence={v.evidence} /> : null}

          {injected?.quote ? (
            <div className="quarantine">
              <span className="quarantine-title"><EyeOff />Where this instruction came from</span>
              <blockquote>{injected.quote}</blockquote>
            </div>
          ) : null}

          {enforced && item.awaiting ? (
            <div className="choices">
              {v.alternative ? (
                <>
                  <button className="btn btn-primary" disabled={item.sending} onClick={() => onDecide(item.step_id, "alt")}>
                    Buy from {v.alternative.product.seller.name} for {rs(v.alternative.product.price * (p.qty || 1))}
                  </button>
                  <button className="btn" disabled={item.sending} onClick={() => onDecide(item.step_id, "approve")}>
                    Buy as picked, {rs(v.amount)}
                  </button>
                </>
              ) : (
                <button className="btn btn-primary" disabled={item.sending} onClick={() => onDecide(item.step_id, "approve")}>
                  {p.kind === "share" ? "Share it" : `Approve ${rs(v.amount)}`}
                </button>
              )}
              <button className="btn" disabled={item.sending} onClick={() => onDecide(item.step_id, "skip")}>Skip</button>
            </div>
          ) : null}

          {enforced && v.verdict === "block" && v.alternative ? (
            <div className="decided">Guardian told your agent about a better listing: {v.alternative.why}</div>
          ) : null}

          {item.decision ? (
            <div className="decided">
              {item.decision === "approve" && "You approved it."}
              {item.decision === "alt" && `You picked the better listing${item.order ? ` for ${rs(item.order.amount)}` : ""}.`}
              {item.decision === "skip" && "You said no. Your agent moved on."}
            </div>
          ) : null}

          {!enforced && (item.order || item.sharedOut) ? (
            <div className="decided">
              {item.order ? `Charged ${rs(item.order.amount)} to your account.` : `Your ${FIELD_NAME[item.sharedOut.field] || item.sharedOut.field} was sent to ${item.sharedOut.with}.`}
            </div>
          ) : null}
        </div>
      )}
    </li>
  );
}