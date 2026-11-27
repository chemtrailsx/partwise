import { useEffect, useMemo, useState } from "react";
import { MapPin, Truck, Search } from "lucide-react";
import { api } from "../api";
import { inr, inrShort, KindBadge } from "../ui";

interface Roof {
  id: string; name: string; short: string; area: string; lat: number; lng: number; is_home: number; distance_km: number;
  units: number; units_by_condition: Record<string, number>; stock_value: number; idle_value: number;
  idle_items: { part_name: string; condition: string; grade: string | null; qty: number; price: number; days_in_stock: number }[];
}
interface Inv { id: number; rooftop_id: string; part_id: string; part_name: string; category: string; condition: "new" | "remanufactured" | "recycled"; grade: string | null; qty: number; price: number; warranty_months: number; days_in_stock: number; new_price: number }
interface Net { home: Roof; rooftops: Roof[]; inventory: Inv[]; transfers: { id: number; part_name: string; from_rooftop: string; to_rooftop: string; status: string; fee: number; created_at: string }[]; max_transfer_km: number }

export default function Network() {
  const [n, setN] = useState<Net | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { api.get<Net>("/api/network").then(setN); }, []);

  const proj = useMemo(() => {
    if (!n) return null;
    const lats = n.rooftops.map((r) => r.lat), lngs = n.rooftops.map((r) => r.lng);
    const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    return (lat: number, lng: number) => ({ x: 60 + ((lng - minLng) / (maxLng - minLng)) * 480, y: 40 + ((maxLat - lat) / (maxLat - minLat)) * 280 });
  }, [n]);

  if (!n || !proj) return <div className="text-slate-400">Loading…</div>;
  const home = n.rooftops.find((r) => r.is_home)!;
  const hp = proj(home.lat, home.lng);
  const totalIdle = n.rooftops.reduce((s, r) => s + r.idle_value, 0);
  const totalValue = n.rooftops.reduce((s, r) => s + r.stock_value, 0);
  const inv = n.inventory.filter((i) => (!active || i.rooftop_id === active) && (!q || i.part_name.toLowerCase().includes(q.toLowerCase())));
  const roofName = Object.fromEntries(n.rooftops.map((r) => [r.id, r.short]));
  // radius of max_transfer_km on the schematic (approx via a known pair)
  const far = n.rooftops.filter((r) => !r.is_home).sort((a, b) => b.distance_km - a.distance_km)[0];
  const fp = proj(far.lat, far.lng);
  const pxPerKm = Math.hypot(fp.x - hp.x, fp.y - hp.y) / far.distance_km;

  return (
    <div className="fade-in space-y-6">
      <div>
        <div className="label">Live stock across every rooftop</div>
        <h1 className="mt-1 text-3xl font-extrabold">Parts network</h1>
        <p className="mt-1 text-slate-400">PartWise only works because ARC already sees stock at every store in one place. {inrShort(totalIdle)} of {inrShort(totalValue)} stock has had no sale for 12+ months.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="card p-4">
          <svg viewBox="0 0 600 360" className="w-full">
            <circle cx={hp.x} cy={hp.y} r={n.max_transfer_km * pxPerKm} fill="#3ecf8e" fillOpacity={0.05} stroke="#3ecf8e" strokeOpacity={0.35} strokeDasharray="5 5" />
            <text x={hp.x} y={hp.y - n.max_transfer_km * pxPerKm + 14} textAnchor="middle" fill="#5ee3a8" fontSize={11} opacity={0.8}>{n.max_transfer_km} km transfer radius</text>
            {n.rooftops.filter((r) => !r.is_home).map((r) => {
              const p = proj(r.lat, r.lng);
              const inRange = r.distance_km <= n.max_transfer_km;
              return <line key={r.id} x1={hp.x} y1={hp.y} x2={p.x} y2={p.y} stroke={inRange ? "#3ecf8e" : "#475569"} strokeOpacity={0.5} strokeDasharray={inRange ? "" : "3 4"} />;
            })}
            {n.rooftops.map((r) => {
              const p = proj(r.lat, r.lng);
              const rad = 10 + Math.sqrt(r.idle_value) / 25;
              const on = active === r.id;
              // Put the label above the bubble when another rooftop sits just below it.
              const crowded = n.rooftops.some((o) => {
                if (o.id === r.id) return false;
                const q = proj(o.lat, o.lng);
                return q.y > p.y && q.y - p.y < 70 && Math.abs(q.x - p.x) < 90;
              });
              const y1 = crowded ? p.y - rad - 22 : p.y + rad + 15;
              return (
                <g key={r.id} onClick={() => setActive(on ? null : r.id)} className="cursor-pointer">
                  <circle cx={p.x} cy={p.y} r={rad} fill={r.is_home ? "#3ecf8e" : "#182823"} stroke={on ? "#fff" : "#3ecf8e"} strokeWidth={on ? 3 : 1.5} />
                  <text x={p.x} y={y1} textAnchor="middle" fill="#e2e8f0" fontSize={12} fontWeight={600}>{r.short}</text>
                  <text x={p.x} y={y1 + 14} textAnchor="middle" fill="#94a3b8" fontSize={10}>{r.is_home ? "this store" : `${Math.round(r.distance_km)} km`} · idle {inrShort(r.idle_value)}</text>
                </g>
              );
            })}
          </svg>
          <div className="text-center text-xs text-slate-500">Bubble size = idle stock value. Click a rooftop to filter. Schematic, not to scale.</div>
        </div>

        <div className="space-y-3">
          {n.rooftops.sort((a, b) => a.distance_km - b.distance_km).map((r) => (
            <button key={r.id} onClick={() => setActive(active === r.id ? null : r.id)} className={`card w-full p-3 text-left transition ${active === r.id ? "border-mint-500" : ""}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold"><MapPin size={14} className={r.is_home ? "text-mint-400" : "text-slate-500"} />{r.name}</div>
                <div className="text-xs text-slate-400">{r.is_home ? "home" : `${Math.round(r.distance_km)} km`}</div>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
                <span>{r.units} units</span>
                <span>new {r.units_by_condition.new}</span>
                <span className="text-mint-300">reman {r.units_by_condition.remanufactured}</span>
                <span className="text-emerald-300">recycled {r.units_by_condition.recycled}</span>
                <span className="ml-auto text-amber-300">idle {inr(r.idle_value)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {n.transfers.length > 0 && (
        <div className="card p-5">
          <div className="mb-2 flex items-center gap-2 font-bold"><Truck size={17} className="text-mint-400" /> Store-to-store transfers requested by PartWise</div>
          {n.transfers.map((t) => (
            <div key={t.id} className="flex flex-wrap justify-between gap-2 border-t border-ink-700 py-2 text-sm">
              <span>{t.part_name}</span>
              <span className="text-slate-400">{roofName[t.from_rooftop]} → {roofName[t.to_rooftop]}</span>
              <span className="chip bg-sky-400/90 text-ink-950">{t.status}</span>
              <span className="text-slate-400">fee {inr(t.fee)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="font-bold">Inventory {active ? `· ${roofName[active]}` : "· all rooftops"} <span className="text-sm font-normal text-slate-500">({inv.length} lines)</span></div>
          <div className="relative w-64"><Search size={14} className="absolute left-3 top-2.5 text-slate-500" /><input className="input pl-8" placeholder="Search parts" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
              <tr><th className="py-2">Part</th><th>Rooftop</th><th>Type</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">vs new</th><th className="text-right">Warranty</th><th className="text-right">In stock</th></tr>
            </thead>
            <tbody>
              {inv.sort((a, b) => a.part_name.localeCompare(b.part_name)).map((i) => (
                <tr key={i.id} className="border-t border-ink-800">
                  <td className="py-2">{i.part_name}</td>
                  <td className="text-slate-400">{roofName[i.rooftop_id]}</td>
                  <td><KindBadge k={i.condition} grade={i.grade} /></td>
                  <td className="text-right">{i.qty}</td>
                  <td className="text-right">{inr(i.price)}</td>
                  <td className="text-right text-mint-400">{i.condition === "new" ? "" : `-${Math.round((1 - i.price / i.new_price) * 100)}%`}</td>
                  <td className="text-right text-slate-400">{i.warranty_months} mo</td>
                  <td className={`text-right ${i.days_in_stock > 365 ? "font-semibold text-amber-300" : "text-slate-400"}`}>{i.days_in_stock} d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
