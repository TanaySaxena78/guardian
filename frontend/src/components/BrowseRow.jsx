import { AgentIcon, EyeOff, PageIcon, SearchIcon } from "./Icons.jsx";
import { rs } from "../format.js";

const WHERE = { listing: "the listing", review: "a review", seller_chat: "the seller chat" };

export function MessageRow({ item }) {
  return (
    <li className="row row-msg">
      <AgentIcon />
      <span>{item.text}</span>
    </li>
  );
}

export function BrowseRow({ item }) {
  if (item.tool === "search") {
    const n = item.results?.length || 0;
    return (
      <li className="row">
        <SearchIcon />
        <span>
          Searched for <b>{item.query}</b>
          <span className="muted">
            {n ? `, ${n} result${n === 1 ? "" : "s"}. Top: ${item.results[0].name}, ${rs(item.results[0].price)}${item.results[0].sponsored ? " (sponsored)" : ""}` : ", nothing found"}
          </span>
        </span>
      </li>
    );
  }
  const flagged = item.flagged || [];
  return (
    <li className="row row-block">
      <div className="row-line">
        <PageIcon />
        <span>Opened <b>{item.product?.name}</b> <span className="muted">from {item.product?.seller?.name}</span></span>
      </div>
      {flagged.length ? (
        <div className={`quarantine ${item.hidden_from_agent ? "" : "leaked"}`}>
          <span className="quarantine-title">
            <EyeOff />
            {item.hidden_from_agent
              ? `Guardian hid ${flagged.length} hidden instruction${flagged.length === 1 ? "" : "s"} from your agent`
              : `${flagged.length} hidden instruction${flagged.length === 1 ? "" : "s"} reached your agent. Guardian is off.`}
          </span>
          {flagged.map((f, i) => (
            <div key={i} className="q-item">
              <blockquote>{f.text}</blockquote>
              <span className="hits">
                Found in {WHERE[f.field] || f.field}. {f.hits.join(". ")}.
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}
