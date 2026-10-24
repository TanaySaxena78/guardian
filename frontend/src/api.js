// Thin wrapper over the FastAPI backend.
const BASE = import.meta.env.VITE_API_BASE || "";

async function call(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = (body && (body.detail || body.message)) || `Request failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return body;
}

export const api = {
  health: () => call("/api/health"),
  profile: () => call("/api/profile"),
  mandate: () => call("/api/mandate"),
  saveMandate: (m) => call("/api/mandate", { method: "PUT", body: JSON.stringify(m) }),
  resetMandate: () => call("/api/mandate/reset", { method: "POST" }),
  compileRule: (text) => call("/api/rules/compile", { method: "POST", body: JSON.stringify({ text }) }),
  startRun: (task, mode, agent) => call("/api/runs", { method: "POST", body: JSON.stringify({ task, mode, agent }) }),
  stopRun: (id) => call(`/api/runs/${id}/stop`, { method: "POST" }),
  decide: (id, step_id, choice) =>
    call(`/api/runs/${id}/decisions`, { method: "POST", body: JSON.stringify({ step_id, choice }) }),
  evals: () => call("/api/evals"),
  runGuardianEvals: (live) => call(`/api/evals/guardian?live=${live ? "true" : "false"}`, { method: "POST" }),
  eventsUrl: (id) => `${BASE}/api/runs/${id}/events`,
};
