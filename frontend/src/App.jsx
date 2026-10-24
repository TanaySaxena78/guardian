import { useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import AppShell from "./AppShell.jsx";
import Landing from "./site/Landing.jsx";

// Routes live in the hash so the site works on any static host:
//   #/            the landing page
//   #/app/run     the working demo (also rules, receipts, evals)
const TABS = ["run", "rules", "receipts", "evals"];

function parse(hash) {
  const m = hash.match(/^#\/app(?:\/(\w+))?/);
  if (m) return { page: "app", tab: TABS.includes(m[1]) ? m[1] : "run" };
  return { page: "home" };
}

export default function App() {
  const [route, setRoute] = useState(() => parse(location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (hash) => {
    if (location.hash !== hash) location.hash = hash;
    window.scrollTo(0, 0);
  };

  return (
    <MotionConfig reducedMotion="user">
      {route.page === "app" ? <AppShell tab={route.tab} go={go} /> : <Landing go={go} />}
    </MotionConfig>
  );
}