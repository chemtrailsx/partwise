import { useEffect, useState } from "react";
import { FlaskConical, Save, History, ArrowRight, CheckCircle2 } from "lucide-react";
import { api, type ROSummary } from "../api";
import { inr, Spinner } from "../ui";

interface RulesResp { version: number; yaml: string; created_at: string; author: string; note: string; parsed: any; history: { version: number; created_at: string; author: string; note: string }[] }
interface Brief { decision: string; option: string; price: number; savings: number; co2_saved: number; scores: { label: string; score: number }[] }
interface Prev { part: string; current: Brief; what_if: Brief }

const W = [
  ["price", "Price"], ["wait", "Wait time"], ["co2", "CO₂"], ["warranty", "Warranty"], ["car_age_fit", "Car-age fit"],
] as const;

export default function Rules() {
  const [r, setR] = useState<RulesResp | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [ros, setRos] = useState<ROSummary[]>([]);
  const [roId, setRoId] = useState("RO-24820");
  const [w, setW] = useState<Record<string, number>>({});
  const [prev, setPrev] = useState<Prev[] | null>(null);
  const [loadingPrev, setLoadingPrev] = useState(false);

  const load = () => api.get<RulesResp>("/api/rules").then((d) => { setR(d); setText(d.yaml); setW(d.parsed.scoring.weights); });
  useEffect(() => { load(); api.get<ROSummary[]>("/api/ros").then(setRos); }, []);

  useEffect(() => {
    if (!Object.keys(w).length) return;
    setLoadingPrev(true);
    const t = setTimeout(() => {
      api.post<Prev[]>("/api/rules/preview", { ro_id: roId, weights: w })
        .then(setPrev).catch(() => setPrev(null)).finally(() => setLoadingPrev(false));
    }, 250);
    return () => clearTimeout(t);
  }, [w, roId]);

  async function publish(yaml = text, n = note) {
    setSaving(true);
    setMsg(null);
    try {
      const d = await api.put<RulesResp>("/api/rules", { yaml, note: n, author: "Dealer admin" });
      setR(d); setText(d.yaml); setW(d.parsed.scoring.weights); setNote("");
      setMsg({ ok: true, t: `Published rules v${d.version}. Re-run PartWise on open repair orders to apply them.` });
    } catch (e: any) {
      setMsg({ ok: false, t: e.message });
    } finally { setSaving(false); }
  }

  function applyWeightsToYaml() {
    let y = text;
    for (const [k] of W) y = y.replace(new RegExp(`(\\n\\s+${k}:\\s*)[0-9.]+`), `$1${(w[k] ?? 0).toFixed(2)}`);
    setText(y);
    publish(y, "Weights tuned in What-if");
  }

  if (!r) return <div className="text-slate-400">Loading…</div>;
  const sum = Object.values(w).reduce((s, x) => s + x, 0) || 1;
  const changed = r && W.some(([k]) => Math.abs((w[k] ?? 0) - r.parsed.scoring.weights[k]) > 1e-6);

  return (
    <div className="fade-in space-y-6">
      <div>
        <div className="label">Configurable per dealer or OEM · versioned</div>
        <h1 className="mt-1 text-3xl font-extrabold">Rules & What-if</h1>
        <p className="mt-1 text-slate-400">Safety and warranty are hard rules. Scoring weights are policy: tune them and see the effect before you publish.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2 font-bold"><FlaskConical size={18} className="text-mint-400" /> What-if simulator</div>
          <div className="mb-4 flex items-center gap-2 text-sm">
            <span className="text-slate-400">Repair order</span>
            <select className="input w-auto" value={roId} onChange={(e) => setRoId(e.target.value)}>
              {ros.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.year} {x.make_model}</option>)}
            </select>
          </div>
          <div className="space-y-3">
            {W.map(([k, label]) => (
              <div key={k} className="grid grid-cols-[110px_1fr_48px] items-center gap-3 text-sm">
                <span className="text-slate-300">{label}</span>
                <input type="range" min={0} max={1} step={0.05} value={w[k] ?? 0} className="accent-mint-500"
                  onChange={(e) => setW({ ...w, [k]: parseFloat(e.target.value) })} />
                <span className="text-right font-semibold text-slate-200">{Math.round(((w[k] ?? 0) / sum) * 100)}%</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-ghost text-xs" onClick={() => setW({ price: 1, wait: 0, co2: 0, warranty: 0, car_age_fit: 0 })}>Cheapest</button>
            <button className="btn-ghost text-xs" onClick={() => setW({ price: 0, wait: 1, co2: 0, warranty: 0, car_age_fit: 0 })}>Fastest</button>
            <button className="btn-ghost text-xs" onClick={() => setW({ price: 0.1, wait: 0.1, co2: 0.7, warranty: 0.05, car_age_fit: 0.05 })}>Greenest</button>
            <button className="btn-ghost text-xs" onClick={() => setW(r.parsed.scoring.weights)}>Current policy</button>
            {changed && <button disabled={saving} className="btn-primary ml-auto text-xs" onClick={applyWeightsToYaml}><Save size={13} /> Publish these weights</button>}
          </div>

          <div className="mt-5 space-y-3">
            {loadingPrev && !prev && <Spinner />}
            {prev?.map((p) => {
              const flip = p.current.option !== p.what_if.option;
              return (
                <div key={p.part} className={`rounded-xl border p-3 ${flip ? "border-amber-400/60 bg-amber-400/5" : "border-ink-700"}`}>
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{p.part}</div>
                    {flip && <span className="chip bg-amber-400 text-ink-950">PICK CHANGES</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-400">{p.current.option} · {inr(p.current.price)}</span>
                    <ArrowRight size={14} className="text-slate-500" />
                    <span className={flip ? "font-semibold text-amber-200" : "text-slate-300"}>{p.what_if.option} · {inr(p.what_if.price)}</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {p.what_if.scores.map((s) => (
                      <div key={s.label} className="flex items-center gap-2 text-xs">
                        <span className="w-48 truncate text-slate-400">{s.label}</span>
                        <div className="h-1.5 flex-1 rounded-full bg-ink-800"><div className="h-full rounded-full bg-mint-500 transition-all" style={{ width: `${s.score}%` }} /></div>
                        <span className="w-8 text-right">{Math.round(s.score)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-bold">rules.yaml <span className="text-sm font-normal text-slate-500">· v{r.version} · {r.parsed.scope}</span></div>
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
              className="h-[420px] w-full resize-y rounded-xl border border-ink-600 bg-ink-950 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-mint-500" />
            <div className="mt-3 flex gap-2">
              <input className="input" placeholder="Change note (e.g. Allow 40 km transfers for pilot)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button onClick={() => publish()} disabled={saving || text === r.yaml} className="btn-primary shrink-0">{saving ? <Spinner /> : <Save size={15} />} Validate & publish</button>
            </div>
            {msg && <div className={`mt-3 flex items-center gap-2 rounded-xl p-3 text-sm ${msg.ok ? "bg-mint-500/10 text-mint-200" : "bg-red-500/10 text-red-200"}`}>{msg.ok && <CheckCircle2 size={15} />}{msg.t}</div>}
          </div>
          <div className="card p-5">
            <div className="mb-2 flex items-center gap-2 font-bold"><History size={16} /> Version history</div>
            {r.history.map((h) => (
              <div key={h.version} className="flex justify-between border-t border-ink-700 py-2 text-sm">
                <span><span className="font-semibold">v{h.version}</span> <span className="text-slate-400">· {h.note || "—"}</span></span>
                <span className="text-xs text-slate-500">{h.author} · {h.created_at.replace("T", " ").slice(0, 16)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
