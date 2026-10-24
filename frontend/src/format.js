export function rs(n) {
  if (n == null || isNaN(n)) return "";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

export function pct(x, digits = 0) {
  if (x == null || isNaN(x)) return "";
  return (x * 100).toFixed(digits) + "%";
}

export function clock(t) {
  if (!t) return "";
  return new Date(t * 1000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export function listJoin(a) {
  if (!a || !a.length) return "";
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
}

export const STAMP = { allow: "Allowed", ask: "Needs you", block: "Blocked" };
export const WOULD = { allow: "Would allow", ask: "Would ask you", block: "Would block" };

export const FIELD_NAME = { phone: "phone number", email: "email", address: "address" };
