import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ClipboardList, LayoutDashboard, Network, SlidersHorizontal, ScrollText, RotateCcw, Sparkles, Leaf, Smartphone } from "lucide-react";
import { api, type Meta } from "../api";

const NAV = [
  { to: "/ros", label: "Advisor Console", icon: ClipboardList },
  { to: "/dashboard", label: "Impact Dashboard", icon: LayoutDashboard },
  { to: "/network", label: "Parts Network", icon: Network },
  { to: "/rules", label: "Rules & What-if", icon: SlidersHorizontal },
  { to: "/audit", label: "Audit Log", icon: ScrollText },
];

export default function Layout() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [resetting, setResetting] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    api.get<Meta>("/api/meta").then(setMeta).catch(() => setMeta(null));
  }, []);

  async function reset() {
    if (!confirm("Reset the demo? All repair orders, choices and rule edits go back to the starting data.")) return;
    setResetting(true);
    await api.post("/api/admin/reset");
    setResetting(false);
    nav("/ros");
    window.location.reload();
  }

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-900/60 p-4 md:flex">
        <div className="mb-1 flex items-center gap-2 px-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-mint-500 text-ink-950"><Leaf size={18} strokeWidth={2.5} /></div>
          <div className="text-xl font-extrabold tracking-tight">Part<span className="text-mint-400">Wise</span></div>
        </div>
        <div className="mb-6 px-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">for Tekion ARC</div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: I }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${isActive ? "bg-mint-500/15 text-mint-300" : "text-slate-300 hover:bg-ink-800"}`}>
              <I size={17} /> {label}
            </NavLink>
          ))}
        </nav>
        <a href="/book" target="_blank" className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-mint-700 px-3 py-2 text-sm font-medium text-mint-300 hover:bg-mint-500/10">
          <Smartphone size={17} /> Customer booking page ↗
        </a>
        <div className="mt-auto space-y-3">
          {meta && (
            <div className="rounded-xl border border-ink-700 p-3 text-xs text-slate-400">
              <div className="font-semibold text-slate-200">{meta.dealer_group}</div>
              <div>Rooftop: {meta.home.short}</div>
              <div>{meta.rooftops.length} rooftops connected</div>
              <div className="mt-2 flex items-center gap-1">
                <Sparkles size={12} className={meta.llm.mode === "llm" ? "text-mint-400" : "text-slate-500"} />
                {meta.llm.mode === "llm" ? `${meta.llm.provider} · ${meta.llm.model}` : "AI: offline mode (no key)"}
              </div>
              <div>Rules v{meta.rules_version}</div>
            </div>
          )}
          <button onClick={reset} disabled={resetting} className="btn-ghost w-full text-xs">
            <RotateCcw size={14} /> {resetting ? "Resetting…" : "Reset demo data"}
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-ink-700 px-4 py-3 md:hidden">
          <div className="text-lg font-extrabold">Part<span className="text-mint-400">Wise</span></div>
          <select className="input w-auto" onChange={(e) => nav(e.target.value)} defaultValue="">
            <option value="" disabled>Menu</option>
            {NAV.map((n) => <option key={n.to} value={n.to}>{n.label}</option>)}
          </select>
        </header>
        <main className="mx-auto max-w-[1400px] p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
