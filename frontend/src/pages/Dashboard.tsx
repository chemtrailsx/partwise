import { useEffect, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, ComposedChart } from "recharts";
import { Download, Building2 } from "lucide-react";
import { api } from "../api";
import { Stat, inr, inrShort, kg } from "../ui";

interface Dash {
  days: number;
  kpis: { lines_analyzed: number; co2_saved_kg: number; customer_savings_inr: number; recycled_uptake: number; wait_days_avoided: number; idle_value_moved: number; savings_per_ro_line: number; green_parts_fitted: number };
  weekly: { week: string; co2: number; co2_per_day: number; savings: number; lines: number; uptake: number }[];
  by_rooftop: { rooftop: string; co2: number; savings: number; uptake: number }[];
  by_category: { category: string; co2: number; count: number }[];
  decision_mix: { decision: string; count: number }[];
  tekion_revenue: { subscription_inr: number; transfer_fees_inr: number; rooftops: number; per_rooftop_month: number };
  recent: { ro_id: string; part_name: string; chosen_condition: string; savings_inr: number; co2_saved_kg: number; created_at: string }[];
}

const tip = { contentStyle: { background: "#13201c", border: "1px solid #2e463d", borderRadius: 12, fontSize: 12 }, labelStyle: { color: "#cbd5e1" } };
const MIX_LABEL: Record<string, string> = { NEW_ONLY: "Safety: new only", WARRANTY: "Warranty covered", RECYCLED_RECOMMENDED: "Recycled recommended", NEW_RECOMMENDED: "New recommended" };
const MIX_COLOR: Record<string, string> = { NEW_ONLY: "bg-sky-400", WARRANTY: "bg-violet-400", RECYCLED_RECOMMENDED: "bg-mint-500", NEW_RECOMMENDED: "bg-slate-400" };

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [days, setDays] = useState(90);
  useEffect(() => { api.get<Dash>(`/api/dashboard?days=${days}`).then(setD); }, [days]);
  if (!d) return <div className="text-slate-400">Loading…</div>;
  const k = d.kpis;
  const mixTotal = d.decision_mix.reduce((s, m) => s + m.count, 0);
  const trees = Math.round(k.co2_saved_kg / 21);

  function exportCsv() {
    const rows = [["week", "lines", "co2_saved_kg", "customer_savings_inr", "green_share"], ...d!.weekly.map((w) => [w.week, w.lines, w.co2, w.savings, w.uptake])];
    const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `partwise-co2-report-${days}d.csv`;
    a.click();
  }

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">Apex Motors Group · pilot metrics</div>
          <h1 className="mt-1 text-3xl font-extrabold">Impact dashboard</h1>
          <p className="mt-1 text-slate-400">The four pilot measures: recycled uptake, ₹ saved per RO, wait days avoided, kg CO₂ avoided.</p>
        </div>
        <div className="flex gap-2">
          {[30, 90].map((n) => (
            <button key={n} onClick={() => setDays(n)} className={days === n ? "btn-primary" : "btn-ghost"}>{n} days</button>
          ))}
          <button onClick={exportCsv} className="btn-ghost"><Download size={15} /> CO₂ report (CSV)</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="CO₂ avoided" value={kg(k.co2_saved_kg)} sub={`≈ ${trees.toLocaleString("en-IN")} trees' yearly absorption`} accent />
        <Stat label="Customer savings" value={inrShort(k.customer_savings_inr)} sub={`${inr(k.savings_per_ro_line)} avg per green part`} accent />
        <Stat label="Recycled uptake" value={`${Math.round(k.recycled_uptake * 100)}%`} sub="when a safe alternative existed" />
        <Stat label="Wait days avoided" value={k.wait_days_avoided.toFixed(0)} sub={`${k.green_parts_fitted} green parts fitted`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-bold">CO₂ avoided per day (weekly avg) & green share</div>
            <div className="flex gap-3 text-xs text-slate-400"><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-mint-500" />kg CO₂</span><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-400" />green share of lines</span></div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={d.weekly}>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3ecf8e" stopOpacity={0.5} /><stop offset="100%" stopColor="#3ecf8e" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="#22362f" vertical={false} />
              <XAxis dataKey="week" tickFormatter={(w) => w.slice(5)} stroke="#64748b" fontSize={11} />
              <YAxis yAxisId="l" stroke="#64748b" fontSize={11} />
              <YAxis yAxisId="r" orientation="right" stroke="#64748b" fontSize={11} tickFormatter={(v) => `${Math.round(v * 100)}%`} domain={[0, 1]} />
              <Tooltip {...tip} formatter={(v: number, n: string) => (n === "uptake" ? [`${Math.round(v * 100)}%`, "Green share"] : [`${v} kg/day`, "CO₂ avoided"])} />
              <Area yAxisId="l" type="monotone" dataKey="co2_per_day" stroke="#3ecf8e" fill="url(#g)" strokeWidth={2} />
              <Line yAxisId="r" type="monotone" dataKey="uptake" stroke="#38bdf8" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <div className="mb-3 font-bold">How PartWise decided</div>
          <div className="flex h-3 overflow-hidden rounded-full">
            {d.decision_mix.map((m) => <div key={m.decision} className={MIX_COLOR[m.decision]} style={{ width: `${(m.count / mixTotal) * 100}%` }} />)}
          </div>
          <div className="mt-4 space-y-2">
            {d.decision_mix.sort((a, b) => b.count - a.count).map((m) => (
              <div key={m.decision} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${MIX_COLOR[m.decision]}`} />{MIX_LABEL[m.decision]}</span>
                <span className="text-slate-400">{m.count} · {Math.round((m.count / mixTotal) * 100)}%</span>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl bg-ink-850 p-3 text-xs text-slate-400">
            {k.lines_analyzed.toLocaleString("en-IN")} part lines analysed. Safety rules fired on every brake, steering, airbag and suspension line.
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-3 font-bold">Recycled uptake by rooftop</div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={d.by_rooftop} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid stroke="#22362f" horizontal={false} />
              <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} stroke="#64748b" fontSize={11} />
              <YAxis type="category" dataKey="rooftop" stroke="#94a3b8" fontSize={11} width={90} />
              <Tooltip {...tip} formatter={(v: number) => [`${Math.round(v * 100)}%`, "Uptake"]} cursor={{ fill: "#182823" }} />
              <Bar dataKey="uptake" fill="#3ecf8e" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <div className="mb-3 font-bold">CO₂ avoided by part category</div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={d.by_category}>
              <CartesianGrid stroke="#22362f" vertical={false} />
              <XAxis dataKey="category" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip {...tip} formatter={(v: number) => [`${v} kg`, "CO₂ avoided"]} cursor={{ fill: "#182823" }} />
              <Bar dataKey="co2" fill="#5ee3a8" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card border-mint-700 p-5 lg:col-span-2">
          <div className="mb-1 flex items-center gap-2 font-bold"><Building2 size={18} className="text-mint-400" /> One recommendation, three winners</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Winner who="Customer" v={inrShort(k.customer_savings_inr)} sub="paid less for the same repair" />
            <Winner who="Dealer group" v={inrShort(k.idle_value_moved)} sub="idle (12+ month) stock turned into sales" />
            <Winner who="Tekion" v={inrShort(d.tekion_revenue.subscription_inr + d.tekion_revenue.transfer_fees_inr)}
              sub={`${d.tekion_revenue.rooftops} rooftops × ${inr(d.tekion_revenue.per_rooftop_month)}/mo + ${inr(d.tekion_revenue.transfer_fees_inr)} transfer fees`} />
          </div>
        </div>
        <div className="card p-5">
          <div className="mb-2 font-bold">Latest live decisions</div>
          {d.recent.length === 0 && <div className="text-sm text-slate-500">Approve a repair order to see it land here in real time.</div>}
          <div className="space-y-2">
            {d.recent.map((r, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span>{r.part_name} <span className="text-slate-500">· {r.ro_id}</span></span>
                <span className={r.chosen_condition === "new" ? "text-slate-400" : "text-mint-400"}>{r.chosen_condition === "new" ? "new" : `${r.co2_saved_kg} kg`}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Winner({ who, v, sub }: { who: string; v: string; sub: string }) {
  return (
    <div className="rounded-xl bg-ink-850 p-4">
      <div className="label">{who}</div>
      <div className="mt-1 text-2xl font-extrabold text-mint-400">{v}</div>
      <div className="text-xs text-slate-400">{sub}</div>
    </div>
  );
}
