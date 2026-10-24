import { useCallback, useEffect, useReducer, useRef } from "react";
import { api } from "./api.js";

const EMPTY = {
  runId: null,
  status: "idle", // idle | starting | running | finished | error | stopped
  task: "",
  mode: "protected",
  agent: "scripted",
  items: [], // timeline: {kind:'msg'|'browse'|'action', ...}
  wallet: null,
  orders: [],
  shared: [],
  errors: [],
  summary: "",
  lastSeq: -1,
};

function updateAction(items, stepId, patch) {
  return items.map((it) => (it.kind === "action" && it.step_id === stepId ? { ...it, ...patch } : it));
}

function reducer(state, ev) {
  if (ev.type === "reset") return { ...EMPTY, ...ev.payload };
  if (ev.type === "local_error") return { ...state, status: state.runId ? state.status : "idle", errors: [...state.errors, ev.message] };
  if (ev.type === "local_decision") return { ...state, items: updateAction(state.items, ev.step_id, { sending: true }) };
  if (ev.seq != null) {
    if (ev.seq <= state.lastSeq) return state; // already seen (EventSource reconnects replay the backlog)
    state = { ...state, lastSeq: ev.seq };
  }
  switch (ev.type) {
    case "run_started":
      return { ...state, status: "running", task: ev.task, mode: ev.mode, agent: ev.agent };
    case "agent_message":
      return ev.text ? { ...state, items: [...state.items, { kind: "msg", seq: ev.seq, text: ev.text, t: ev.t }] } : state;
    case "browse":
      return { ...state, items: [...state.items, { kind: "browse", seq: ev.seq, ...ev }] };
    case "action_proposed":
      return { ...state, items: [...state.items, { kind: "action", seq: ev.seq, step_id: ev.step_id, proposal: ev, t: ev.t }] };
    case "verdict":
      return { ...state, items: updateAction(state.items, ev.step_id, { verdict: ev }) };
    case "awaiting_user":
      return { ...state, items: updateAction(state.items, ev.step_id, { awaiting: true }) };
    case "decision":
      return { ...state, items: updateAction(state.items, ev.step_id, { awaiting: false, sending: false, decision: ev.choice }) };
    case "order_placed":
      return {
        ...state,
        orders: [...state.orders, ev.order],
        items: updateAction(state.items, ev.order.step_id, { order: ev.order }),
      };
    case "data_shared":
      return { ...state, shared: [...state.shared, ev], items: updateAction(state.items, ev.step_id, { sharedOut: ev }) };
    case "wallet": {
      const { seq, t, type, ...w } = ev;
      return { ...state, wallet: w };
    }
    case "error":
      return { ...state, errors: [...state.errors, ev.message] };
    case "run_finished":
      return { ...state, status: ev.status, summary: ev.summary || "", wallet: ev.wallet || state.wallet };
    default:
      return state;
  }
}

export function useRun() {
  const [state, dispatch] = useReducer(reducer, EMPTY);
  const esRef = useRef(null);

  const close = () => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  };

  useEffect(() => close, []);

  const start = useCallback(async (task, mode, agent) => {
    close();
    dispatch({ type: "reset", payload: { status: "starting", task, mode, agent } });
    try {
      const { run_id } = await api.startRun(task, mode, agent);
      dispatch({ type: "reset", payload: { runId: run_id, status: "running", task, mode, agent } });
      const es = new EventSource(api.eventsUrl(run_id));
      esRef.current = es;
      es.onmessage = (m) => {
        const ev = JSON.parse(m.data);
        dispatch(ev);
        if (ev.type === "run_finished") close();
      };
      es.onerror = () => {
        // EventSource retries on its own; the reducer drops repeated events.
      };
    } catch (e) {
      dispatch({ type: "reset", payload: { status: "idle", task, mode, agent } });
      dispatch({ type: "local_error", message: e.message });
    }
  }, []);

  const stop = useCallback(async () => {
    if (state.runId) {
      try {
        await api.stopRun(state.runId);
      } catch (e) {
        dispatch({ type: "local_error", message: e.message });
      }
    }
  }, [state.runId]);

  const decide = useCallback(
    async (stepId, choice) => {
      dispatch({ type: "local_decision", step_id: stepId });
      try {
        await api.decide(state.runId, stepId, choice);
      } catch (e) {
        dispatch({ type: "local_error", message: e.message });
      }
    },
    [state.runId]
  );

  return { state, start, stop, decide };
}
