import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Car, ChevronRight, Zap } from "lucide-react";
import { api, type ROSummary } from "../api";
import { DecisionChip, StatusPill, inr, Stat, Spinner } from "../ui";

export default function ROList() {
  const [ros, setRos] = useState<ROSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get<ROSummary[]>("/api/ros").then(setRos);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000); // online bookings appear without a refresh
    return () => clearInterval(t);
  }, []);

  async function analyzeAll() {
    if (!ros) return;
    setBusy(true);
    try {
      for (const r of ros.filter((r) => r.status === "open" && r.parts.length > 0)) await api.post(`/api/ros/${r.id}/analyze`);
      await load();
    } finally { setBusy(false); }
  }

  if (!ros) return <div className="text-slate-400">Loading repair orders…</div>;
  const open = ros.filter((r) => r.status === "open").length;
  const savings = ros.reduce((s, r) => s + r.potential_savings, 0);
  const co2 = ros.reduce((s, r) => s + r.potential_co2, 0);

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">Advisor Console · Today</div>
          <h1 className="mt-1 text-3xl font-extrabold">Repair orders</h1>
          <p className="mt-1 text-slate-400">Every part line is checked against live stock at all rooftops before the customer sees a quote.</p>
        </div>
        <div className="flex gap-2">
          {open > 0 && (
            <button onClick={analyzeAll} disabled={busy} className="btn-ghost">
              {busy ? <Spinner /> : <Zap size={16} />} Run PartWise on {open} open RO{open > 1 ? "s" : ""}
            </button>
          )}
          <Link to="/ros/new" className="btn-primary"><Plus size={16} /> New repair order</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Repair orders today" value={String(ros.length)} />
        <Stat label="Awaiting analysis" value={String(open)} />
        <Stat label="Customer savings found" value={inr(savings)} accent />
        <Stat label="CO₂ avoidable" value={`${co2.toFixed(1)} kg`} accent />
      </div>

      <div className="space-y-3">
        {ros.map((r) => (
          <Link key={r.id} to={`/ros/${r.id}`} className="card group flex flex-wrap items-center gap-4 p-4 transition hover:border-mint-600">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-ink-800 text-slate-300"><Car size={20} /></div>
            <div className="min-w-[220px] flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold">{r.id}</span>
                <StatusPill s={r.status} />
                {r.source === "customer" && <span className="chip bg-mint-500/15 text-mint-300">ONLINE BOOKING</span>}
              </div>
              <div className="text-sm text-slate-300">{r.year} {r.make_model} · {r.km.toLocaleString("en-IN")} km · {r.customer_name}</div>
              <div className="text-xs text-slate-500">{r.complaint}</div>
            </div>
            <div className="flex max-w-[460px] flex-wrap gap-1.5">
              {r.decisions.length
                ? r.decisions.map((d, i) => <DecisionChip key={i} d={d} />)
                : r.parts.map((p) => <span key={p} className="chip bg-ink-800 text-slate-300">{p}</span>)}
            </div>
            <div className="w-28 text-right">
              {r.potential_savings > 0 ? (
                <>
                  <div className="font-bold text-mint-400">{inr(r.potential_savings)}</div>
                  <div className="text-xs text-slate-500">{r.potential_co2} kg CO₂</div>
                </>
              ) : <div className="text-xs text-slate-500">{r.decisions.length ? "no saving" : "not analysed"}</div>}
            </div>
            <ChevronRight className="text-slate-600 group-hover:text-mint-400" />
          </Link>
        ))}
      </div>
    </div>
  );
}
