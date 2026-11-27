import { ShieldAlert, ShieldCheck, Recycle, Sparkles, Package } from "lucide-react";
import type { Decision, Kind } from "./api";

export const inr = (n: number) =>
  (n < 0 ? "-₹" : "₹") + Math.round(Math.abs(n)).toLocaleString("en-IN");

export const inrShort = (n: number) => {
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return inr(n);
};

export const kg = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} t` : `${n.toFixed(1)} kg`);

export const ready = (d: number) => (d === 0 ? "Ready today" : d === 1 ? "Ready tomorrow" : `Ready in ${d} days`);

export const kindLabel: Record<Kind, string> = {
  new: "New",
  remanufactured: "Remanufactured",
  recycled: "Recycled",
  warranty: "Warranty part",
};

export function DecisionChip({ d }: { d: Decision }) {
  const m: Record<Decision, [string, string, JSX.Element]> = {
    NEW_ONLY: ["NEW ONLY · SAFETY", "bg-sky-400/90 text-ink-950", <ShieldAlert size={12} key="i" />],
    WARRANTY: ["COVERED · ₹0", "bg-violet-400/90 text-ink-950", <ShieldCheck size={12} key="i" />],
    RECYCLED_RECOMMENDED: ["RECYCLED · RECOMMENDED", "bg-mint-500 text-ink-950", <Recycle size={12} key="i" />],
    NEW_RECOMMENDED: ["NEW · RECOMMENDED", "bg-slate-300 text-ink-950", <Package size={12} key="i" />],
  };
  const [t, c, i] = m[d];
  return <span className={`chip ${c}`}>{i}{t}</span>;
}

export function KindBadge({ k, grade }: { k: Kind; grade?: string | null }) {
  const c: Record<Kind, string> = {
    new: "bg-slate-700 text-slate-100",
    remanufactured: "bg-mint-700/60 text-mint-300",
    recycled: "bg-emerald-900/70 text-emerald-300",
    warranty: "bg-violet-900/70 text-violet-200",
  };
  return (
    <span className={`chip ${c[k]}`}>
      {kindLabel[k]}
      {grade ? ` · Grade ${grade}` : ""}
    </span>
  );
}

export function StatusPill({ s }: { s: string }) {
  const m: Record<string, [string, string]> = {
    open: ["Open", "bg-slate-700 text-slate-200"],
    recommended: ["Ready for review", "bg-amber-400/90 text-ink-950"],
    awaiting_customer: ["Sent to customer", "bg-sky-400/90 text-ink-950"],
    customer_approved: ["Customer approved", "bg-mint-500 text-ink-950"],
    closed: ["Closed", "bg-slate-600 text-slate-200"],
  };
  const [t, c] = m[s] ?? [s, "bg-slate-700"];
  return <span className={`chip ${c}`}>{t}</span>;
}

export function AiBadge({ mode }: { mode: string }) {
  const live = mode.startsWith("llm") || mode === "cache";
  const provider = mode.startsWith("llm:") ? mode.slice(4) : "AI";
  return (
    <span
      title={live ? "Written by an LLM from decision data only" : "Deterministic template (" + mode + ")"}
      className={`chip ${live ? "bg-mint-500/15 text-mint-300" : "bg-slate-700/60 text-slate-300"}`}
    >
      <Sparkles size={11} /> {live ? `AI · ${provider}` : "Grounded template"}
    </span>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${accent ? "text-mint-400" : "text-white"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}
