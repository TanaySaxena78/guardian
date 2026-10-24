// The gate G: a G whose crossbar is a checkpoint barrier.
export function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="icon">
      <path d="M47.6 14.4 A23 23 0 1 0 55 32" fill="none" stroke="var(--cherry)" strokeWidth="8.5" strokeLinecap="round" />
      <path d="M34 32 H58" stroke="var(--tang)" strokeWidth="8.5" strokeLinecap="round" />
    </svg>
  );
}

export function AgentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="icon">
      <rect x="2" y="4" width="14" height="11" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6.5" cy="9.5" r="1.3" fill="currentColor" />
      <circle cx="11.5" cy="9.5" r="1.3" fill="currentColor" />
      <path d="M9 1.5V4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="icon">
      <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function PageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="icon">
      <rect x="3" y="1.8" width="10" height="12.4" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.6 5.5h4.8M5.6 8h4.8M5.6 10.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function EyeOff() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="icon">
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 13.5 13.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function Dot({ kind }) {
  if (kind === "ok")
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="icon">
        <circle cx="9" cy="9" r="8" fill="var(--allow-soft)" />
        <path d="M5.5 9.3 7.8 11.6 12.5 6.6" fill="none" stroke="var(--allow)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (kind === "ask")
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="icon">
        <circle cx="9" cy="9" r="8" fill="var(--tang-soft)" />
        <path d="M9 5v5" stroke="var(--tang-text)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="9" cy="12.8" r="1.1" fill="var(--tang-text)" />
      </svg>
    );
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="icon">
      <circle cx="9" cy="9" r="8" fill="var(--cherry)" />
      <path d="M6 6l6 6M12 6l-6 6" stroke="var(--on-cherry)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}