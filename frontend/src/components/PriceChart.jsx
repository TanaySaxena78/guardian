import { rs } from "../format.js";

// 12-week price history against its typical price. The accent dot is today's price.
export default function PriceChart({ evidence }) {
  const h = evidence?.history || [];
  if (h.length < 2) return null;
  const W = 300, H = 72, pad = 7;
  const all = h.concat([evidence.typical]);
  const lo = Math.min(...all) * 0.985;
  const hi = Math.max(...all) * 1.01;
  const x = (i) => pad + (i * (W - pad * 2)) / (h.length - 1);
  const y = (v) => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
  const line = h.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(h.length - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z`;
  const ty = y(evidence.typical).toFixed(1);
  return (
    <div className="evidence">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={`Price over 12 weeks. Usually ${rs(evidence.typical)}, today ${rs(evidence.price)}.`}>
        <path d={area} style={{ fill: "var(--sky-soft)" }} />
        <line x1={pad} x2={W - pad} y1={ty} y2={ty} vectorEffect="non-scaling-stroke"
          style={{ stroke: "var(--ink-2)", strokeWidth: 1, strokeDasharray: "4 4", opacity: 0.7 }} />
        <path d={line} vectorEffect="non-scaling-stroke" style={{ fill: "none", stroke: "var(--ink)", strokeWidth: 2 }} />
        <circle cx={x(h.length - 1)} cy={y(h[h.length - 1])} r="5" style={{ fill: "var(--tang)", stroke: "var(--surface)", strokeWidth: 2 }} />
      </svg>
      <div className="ev-legend num">
        <span>Usually <b>{rs(evidence.typical)}</b></span>
        <span>Today <b>{rs(evidence.price)}</b></span>
        {evidence.mrp ? <span>MRP shown <s>{rs(evidence.mrp)}</s></span> : null}
      </div>
    </div>
  );
}