import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Zap, ShieldAlert } from "lucide-react";
import { api, type RO } from "../api";
import { inr, Spinner } from "../ui";

interface Part { id: string; name: string; category: string; safety_critical: number; new_price: number }
interface Veh { id: string; customer_name: string; make_model: string; year: number; km: number; factory_warranty_until: string; ext_warranty_active: number; ext_warranty_categories: string[] }

const CATS = ["electrical", "hvac", "engine", "transmission", "body"];

export default function NewRO() {
  const nav = useNavigate();
  const [parts, setParts] = useState<Part[]>([]);
  const [vehicles, setVehicles] = useState<Veh[]>([]);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [vid, setVid] = useState("");
  const [nv, setNv] = useState({ customer_name: "", phone: "+91 ", make_model: "", body: "hatchback", year: 2018, km: 70000, factory_warranty_until: "2021-06-30", ext_warranty_active: false, ext_warranty_categories: [] as string[], ext_warranty_until: "" });
  const [complaint, setComplaint] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [add, setAdd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get<Part[]>("/api/catalog").then((p) => { setParts(p); setAdd(p[0]?.id ?? ""); });
    api.get<Veh[]>("/api/vehicles").then((v) => { setVehicles(v); setVid(v[0]?.id ?? ""); });
  }, []);

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      const body: any = { complaint, lines: lines.map((p) => ({ part_id: p, labor_desc: `Replace ${parts.find((x) => x.id === p)?.name.toLowerCase()}` })) };
      if (mode === "existing") body.vehicle_id = vid;
      else body.new_vehicle = { ...nv, ext_warranty_until: nv.ext_warranty_active ? nv.ext_warranty_until : null };
      const ro = await api.post<RO>("/api/ros", body);
      nav(`/ros/${ro.id}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const pmap = Object.fromEntries(parts.map((p) => [p.id, p]));

  return (
    <div className="fade-in mx-auto max-w-3xl space-y-6">
      <Link to="/ros" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"><ArrowLeft size={14} /> Back</Link>
      <div>
        <div className="label">Simulates a new repair order arriving from Tekion ARC</div>
        <h1 className="mt-1 text-3xl font-extrabold">New repair order</h1>
      </div>

      <div className="card space-y-4 p-5">
        <div className="flex gap-2">
          <button className={mode === "existing" ? "btn-primary" : "btn-ghost"} onClick={() => setMode("existing")}>Existing customer</button>
          <button className={mode === "new" ? "btn-primary" : "btn-ghost"} onClick={() => setMode("new")}>New customer & vehicle</button>
        </div>
        {mode === "existing" ? (
          <select className="input" value={vid} onChange={(e) => setVid(e.target.value)}>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.customer_name} · {v.year} {v.make_model} · {v.km.toLocaleString("en-IN")} km</option>)}
          </select>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Customer name"><input className="input" value={nv.customer_name} onChange={(e) => setNv({ ...nv, customer_name: e.target.value })} /></F>
            <F label="Mobile"><input className="input" value={nv.phone} onChange={(e) => setNv({ ...nv, phone: e.target.value })} /></F>
            <F label="Make & model"><input className="input" placeholder="e.g. Kia Seltos" value={nv.make_model} onChange={(e) => setNv({ ...nv, make_model: e.target.value })} /></F>
            <F label="Body"><select className="input" value={nv.body} onChange={(e) => setNv({ ...nv, body: e.target.value })}>{["hatchback", "sedan", "SUV", "MUV"].map((b) => <option key={b}>{b}</option>)}</select></F>
            <F label="Year"><input type="number" className="input" value={nv.year} onChange={(e) => setNv({ ...nv, year: +e.target.value })} /></F>
            <F label="Odometer (km)"><input type="number" className="input" value={nv.km} onChange={(e) => setNv({ ...nv, km: +e.target.value })} /></F>
            <F label="Factory warranty until"><input type="date" className="input" value={nv.factory_warranty_until} onChange={(e) => setNv({ ...nv, factory_warranty_until: e.target.value })} /></F>
            <F label="Extended warranty">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-mint-500" checked={nv.ext_warranty_active} onChange={(e) => setNv({ ...nv, ext_warranty_active: e.target.checked })} /> Active</label>
            </F>
            {nv.ext_warranty_active && (
              <>
                <F label="Extended warranty until"><input type="date" className="input" value={nv.ext_warranty_until} onChange={(e) => setNv({ ...nv, ext_warranty_until: e.target.value })} /></F>
                <F label="Covers">
                  <div className="flex flex-wrap gap-2">
                    {CATS.map((c) => (
                      <label key={c} className="flex items-center gap-1 text-xs"><input type="checkbox" className="accent-mint-500" checked={nv.ext_warranty_categories.includes(c)}
                        onChange={(e) => setNv({ ...nv, ext_warranty_categories: e.target.checked ? [...nv.ext_warranty_categories, c] : nv.ext_warranty_categories.filter((x) => x !== c) })} />{c}</label>
                    ))}
                  </div>
                </F>
              </>
            )}
          </div>
        )}
        <F label="Customer complaint"><input className="input" value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="e.g. Battery light on, starter clicking" /></F>
      </div>

      <div className="card space-y-3 p-5">
        <div className="font-bold">Part lines</div>
        <div className="flex gap-2">
          <select className="input" value={add} onChange={(e) => setAdd(e.target.value)}>
            {parts.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.category}{p.safety_critical ? " · safety" : ""} · {inr(p.new_price)}</option>)}
          </select>
          <button className="btn-ghost shrink-0" onClick={() => add && setLines([...lines, add])}><Plus size={15} /> Add</button>
        </div>
        {lines.length === 0 && <div className="text-sm text-slate-500">Add at least one part.</div>}
        {lines.map((p, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl bg-ink-850 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">{pmap[p]?.safety_critical ? <ShieldAlert size={14} className="text-sky-400" /> : null}{pmap[p]?.name}</span>
            <span className="flex items-center gap-3 text-slate-400">{inr(pmap[p]?.new_price ?? 0)}<button onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={14} /></button></span>
          </div>
        ))}
      </div>

      {err && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>}
      <button onClick={submit} disabled={busy || !lines.length} className="btn-primary w-full py-3 text-base">{busy ? <Spinner /> : <Zap size={18} />} Create & run PartWise</button>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="label mb-1">{label}</div>{children}</label>;
}
