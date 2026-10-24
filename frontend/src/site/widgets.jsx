// Small interactive pieces for the site, built on Motion.
// Patterns borrowed from Motion Primitives (text loop, animated number, tilt), Magic UI
// (animated list, animated beam) and React Bits (scramble text), rewritten for plain CSS.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useInView, useReducedMotion, useSpring } from "motion/react";
import { personAvatar, sellerAvatar } from "./avatars.js";
import { VERDICT_LABEL } from "./pieces.js";

export const rs = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

/* ---------- Logo: the pause tile ---------- */
export function Logo({ size = 30, title }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <rect x="4" y="4" width="56" height="56" rx="18" fill="#FF5C34" />
      <rect x="21" y="19" width="8" height="26" rx="4" fill="#351E28" />
      <rect x="35" y="19" width="8" height="26" rx="4" fill="#351E28" />
    </svg>
  );
}

/* ---------- Rotating words ---------- */
export function TextLoop({ items, interval = 2300, className = "" }) {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % items.length), interval);
    return () => clearInterval(t);
  }, [items.length, interval]);
  return (
    <span className={`loop ${className}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={i}
          initial={reduce ? { opacity: 0 } : { y: "0.5em", opacity: 0, filter: "blur(6px)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          exit={reduce ? { opacity: 0 } : { y: "-0.5em", opacity: 0, filter: "blur(6px)" }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          {items[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ---------- Numbers that count up when seen ---------- */
export function Counter({ to, format = (n) => Math.round(n).toLocaleString("en-IN"), duration = 1.6 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const c = animate(0, to, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: setV });
    return () => c.stop();
  }, [inView, to, duration]);
  return <span ref={ref} className="num">{format(v)}</span>;
}

/* A number that springs to each new value */
export function LiveNumber({ value, format = rs }) {
  const spring = useSpring(value, { stiffness: 90, damping: 18 });
  const [v, setV] = useState(value);
  useEffect(() => { spring.set(value); }, [value, spring]);
  useEffect(() => spring.on("change", setV), [spring]);
  return <span className="num">{format(v)}</span>;
}

/* ---------- Card that tilts and catches light ---------- */
export function Tilt({ children, className = "", max = 8 }) {
  const ref = useRef(null);
  const rx = useSpring(0, { stiffness: 180, damping: 18 });
  const ry = useSpring(0, { stiffness: 180, damping: 18 });
  const reduce = useReducedMotion();
  const move = (e) => {
    if (reduce) return;
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    ry.set((px - 0.5) * max * 2);
    rx.set(-(py - 0.5) * max * 2);
    ref.current.style.setProperty("--mx", `${px * 100}%`);
    ref.current.style.setProperty("--my", `${py * 100}%`);
  };
  const leave = () => { rx.set(0); ry.set(0); };
  return (
    <motion.div ref={ref} className={`tilt ${className}`} onMouseMove={move} onMouseLeave={leave}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}>
      {children}
    </motion.div>
  );
}

/* ---------- Scrolling strip ---------- */
export function Marquee({ items, className = "" }) {
  const row = items.map((t, i) => <span className="marquee-item" key={i}>{t}</span>);
  return (
    <div className={`marquee ${className}`}>
      <div className="marquee-track">{row}{row.map((r, i) => <span className="marquee-item" key={`b${i}`} aria-hidden="true">{items[i]}</span>)}</div>
    </div>
  );
}

/* ---------- Text that decodes itself ---------- */
const GLYPHS = "!<>-_\\/[]{}=+*^?#░▒▓";
export function Scramble({ text, className = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: false, margin: "-80px" });
  const reduce = useReducedMotion();
  const [out, setOut] = useState(text);
  const run = () => {
    if (reduce) { setOut(text); return; }
    let frame = 0;
    const total = 60;
    const id = setInterval(() => {
      frame += 1;
      const done = Math.floor((frame / total) * text.length);
      setOut(text.split("").map((ch, i) => (i < done || ch === " " ? ch : GLYPHS[(i * 7 + frame) % GLYPHS.length])).join(""));
      if (frame >= total) { clearInterval(id); setOut(text); }
    }, 28);
    return () => clearInterval(id);
  };
  useEffect(() => { if (inView) return run(); }, [inView]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref} className={className} onMouseEnter={run}>{out}</span>;
}

/* ---------- Live decision feed with a Guardian switch ---------- */
const EVENTS = [
  { who: "Shree Grocers", what: "Kheti Gold atta, 10 kg", verdict: "allow", amount: 489 },
  { who: "MobileHub Express", what: "Care+ plan added from a review", verdict: "block", amount: 2999 },
  { who: "MobileHub Express", what: "Nova X5 at a fake “60% off”", verdict: "ask", amount: 1700 },
  { who: "QuickDeals24", what: "Pressure cooker, seller rated 3.2★", verdict: "block", amount: 1299 },
  { who: "Shree Grocers", what: "Toor dal, 2 kg", verdict: "allow", amount: 338 },
  { who: "Seller chat", what: "Asked for your phone number", verdict: "block", amount: 0 },
  { who: "SoundCity", what: "Earbuds you didn't ask for", verdict: "ask", amount: 1899 },
  { who: "Store Gift Cards", what: "₹2,000 card “for cashback”", verdict: "block", amount: 2000 },
];

export function VerdictFeed() {
  const ref = useRef(null);
  const inView = useInView(ref, { margin: "-60px" });
  const [on, setOn] = useState(true);
  const [items, setItems] = useState(() => EVENTS.slice(0, 5).map((e, i) => ({ ...e, id: i, on: true })).reverse());
  const [stats, setStats] = useState({ checked: 5, block: 2, ask: 1 });
  const next = useRef(5);
  const [kept, setKept] = useState(5998);
  const [lost, setLost] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const t = setInterval(() => {
      const k = next.current++;
      const e = EVENTS[k % EVENTS.length];
      setItems((list) => [{ ...e, id: k, on }, ...list].slice(0, 5));
      setStats((st) => ({ checked: st.checked + 1, block: st.block + (on && e.verdict === "block" ? 1 : 0), ask: st.ask + (on && e.verdict === "ask" ? 1 : 0) }));
      if (e.verdict !== "allow") (on ? setKept : setLost)((v) => v + e.amount);
    }, 2100);
    return () => clearInterval(t);
  }, [inView, on]);

  return (
    <div ref={ref} className="feed-widget">
      <div className="fw-head">
        <div>
          <span className="fw-label">{on ? "Kept by Guardian" : "Lost with Guardian off"}</span>
          <span className={`fw-total ${on ? "" : "bad"}`}><LiveNumber value={on ? kept : lost} /></span>
        </div>
        <button className={`switch-pill ${on ? "on" : ""}`} role="switch" aria-checked={on} onClick={() => setOn((v) => !v)}>
          <span className="knob" />
          {on ? "Guardian on" : "Guardian off"}
        </button>
      </div>
      <ul className="fw-list">
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((it) => {
            const shown = it.on ? it.verdict : it.verdict === "allow" ? "allow" : "through";
            return (
              <motion.li key={it.id} layout initial={{ opacity: 0, y: -14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }} transition={{ type: "spring", stiffness: 260, damping: 26 }} className="fw-row">
                <img src={sellerAvatar(it.who)} alt="" width="34" height="34" />
                <div className="fw-text"><b>{it.what}</b><span>{it.who}</span></div>
                <span className={`vpill ${shown}`}>{shown === "through" ? "Went through" : VERDICT_LABEL[shown]}</span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      <div className="fw-stats">
        <span><b className="num">{stats.checked}</b> actions checked</span>
        <span><b className="num">{stats.block}</b> blocked</span>
        <span><b className="num">{stats.ask}</b> asked you</span>
      </div>
    </div>
  );
}

/* ---------- Agent → Guardian → checkout, with a packet that gets judged ---------- */
const FLOW = [
  { verdict: "allow", cx: [70, 260, 450], label: "Atta, ₹489. Allowed." },
  { verdict: "ask", cx: [70, 260, 260], label: "“60% off” phone. Needs you." },
  { verdict: "block", cx: [70, 250, 110], label: "Hidden instruction. Blocked." },
];
const FLOW_COLOR = { allow: "#C0DB3A", ask: "#FCF951", block: "#EB3C27" };

export function FlowBeam() {
  const ref = useRef(null);
  const inView = useInView(ref, { margin: "-40px" });
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const t = setInterval(() => setStep((s) => s + 1), 2800);
    return () => clearInterval(t);
  }, [inView]);
  const f = FLOW[step % FLOW.length];
  return (
    <div ref={ref} className="flow-widget">
      <svg viewBox="0 0 520 170" role="img" aria-label="Your agent's actions pass through Guardian before reaching checkout">
        <defs>
          <linearGradient id="beam" x1="0" x2="1">
            <stop offset="0" stopColor="#5A6499" /><stop offset="0.5" stopColor="#FF5C34" /><stop offset="1" stopColor="#C0DB3A" />
          </linearGradient>
        </defs>
        <path d="M70 85 H450" stroke="#3E383C" strokeWidth="6" strokeLinecap="round" />
        <path d="M70 85 H450" stroke="url(#beam)" strokeWidth="3" strokeLinecap="round" className="beam-dash" />
        <g>
          <circle cx="70" cy="85" r="34" fill="#5A6499" />
          <text x="70" y="93" textAnchor="middle" className="node-glyph" style={{ fill: "#F0EEE4" }}>AI</text>
          <text x="70" y="146" textAnchor="middle" className="node-label">Your agent</text>
        </g>
        <g>
          <rect x="226" y="51" width="68" height="68" rx="22" fill="#FF5C34" />
          <rect x="248" y="70" width="9" height="30" rx="4.5" fill="#351E28" />
          <rect x="263" y="70" width="9" height="30" rx="4.5" fill="#351E28" />
          <text x="260" y="146" textAnchor="middle" className="node-label">Guardian</text>
        </g>
        <g>
          <circle cx="450" cy="85" r="34" fill="#F0EEE4" />
          <path d="M434 74h5l5 18h15l4-12h-21" fill="none" stroke="#351E28" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="446" cy="98" r="2.6" fill="#351E28" /><circle cx="457" cy="98" r="2.6" fill="#351E28" />
          <text x="450" y="146" textAnchor="middle" className="node-label">Checkout</text>
        </g>
        <motion.circle key={step} cy="85" r="10" fill={FLOW_COLOR[f.verdict]} stroke="#1C181B" strokeWidth="2"
          initial={{ cx: 70 }} animate={{ cx: f.cx }} transition={{ duration: 2, times: [0, 0.55, 1], ease: "easeInOut" }} />
      </svg>
      <AnimatePresence mode="wait">
        <motion.p key={step} className={`flow-caption ${f.verdict}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
          {f.label}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

/* ---------- Rules typed in plain words, compiled into limits ---------- */
const RULES = [
  ["Ask me before anything over ₹1,500", "Ask before any order over ₹1,500"],
  ["No sellers under 4.2 stars", "Only sellers rated 4.2★ or higher"],
  ["Kharcha ₹30,000 se zyada nahi", "Spend at most ₹30,000 this sale"],
  ["Never share my address", "Never share your address"],
];
export function RuleTyper() {
  const ref = useRef(null);
  const inView = useInView(ref, { margin: "-40px" });
  const [r, setR] = useState(0);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!inView) return;
    const [src] = RULES[r % RULES.length];
    let i = 0;
    setTyped(""); setDone(false);
    const t = setInterval(() => {
      i += 1;
      setTyped(src.slice(0, i));
      if (i >= src.length) {
        clearInterval(t);
        setTimeout(() => setDone(true), 350);
        setTimeout(() => setR((x) => x + 1), 2600);
      }
    }, 45);
    return () => clearInterval(t);
  }, [r, inView]);
  const [, out] = RULES[r % RULES.length];
  return (
    <div ref={ref} className="rule-widget">
      <div className="rule-input"><span>{typed}</span><span className="caret" /></div>
      <AnimatePresence>
        {done ? (
          <motion.div className="rule-out" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            Guardian read this as <b>{out}</b>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---------- People in the story ---------- */
export function Person({ seed, bg, name, role }) {
  return (
    <div className="person">
      <img src={personAvatar(seed, bg)} alt="" width="56" height="56" />
      <div><b>{name}</b><span>{role}</span></div>
    </div>
  );
}

export function AvatarStack({ seeds }) {
  return (
    <div className="avatar-stack">
      {seeds.map((s, i) => <img key={s} src={personAvatar(s, ["F3D5D8", "DCEBEF", "EAF3B8", "FBF8C4", "DFE2F1"][i % 5])} alt="" width="40" height="40" style={{ zIndex: seeds.length - i }} />)}
    </div>
  );
}