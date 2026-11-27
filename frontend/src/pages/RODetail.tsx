import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, Zap, Search, Scale, Calculator, Sparkles, CheckCircle2, Send, MessageSquare, ChevronDown,
  Truck, Leaf, Clock, IndianRupee, ShieldCheck, Lock, Eye, ExternalLink, RefreshCw, Trash2, Plus, Smartphone, Mic,
} from "lucide-react";
import { api, type Line, type Option, type Part, type RO } from "../api";
import { AiBadge, DecisionChip, KindBadge, StatusPill, inr, ready, Spinner, kindLabel } from "../ui";

const STEPS = [
  { icon: Search, label: "Stock search", sub: "all rooftops" },
  { icon: Scale, label: "Rules engine", sub: "safety · warranty" },
  { icon: Calculator, label: "Scoring", sub: "price · wait · CO₂ · warranty · age" },
  { icon: Sparkles, label: "AI explainer", sub: "decision data only" },
];

const FEATURE_COLORS: Record<string, string> = {
  price: "bg-mint-500", wait: "bg-sky-400", co2: "bg-emerald-300", warranty: "bg-violet-400", car_age_fit: "bg-amber-400",
};
const FEATURE_LABEL: Record<string, string> = {
  price: "Price", wait: "Wait", co2: "CO₂", warranty: "Warranty", car_age_fit: "Car-age fit",
};

export default function RODetail() {
  const { id } = useParams();
  const [ro, setRo] = useState<RO | null>(null);
  const [err, setErr] = useState("");
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(-1);
  const [sel, setSel] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [approving, setApproving] = useState(false);
  const [phoneKey, setPhoneKey] = useState(0);
  const prevStatus = useRef<string>();

  const load = () => api.get<RO>(`/api/ros/${id}`).then((r) => { setRo(r); return r; });

  useEffect(() => { load().catch((e) => setErr(e.message)); }, [id]);

  // Default selection = approved option, else the recommendation.
  useEffect(() => {
    if (!ro) return;
    const s: Record<number, string> = {};
    ro.lines.forEach((l) => {
      if (l.recommendation) s[l.id] = l.approved_option ?? l.recommendation.payload.recommended_id;
    });
    setSel(s);
  }, [ro?.lines.map((l) => l.recommendation?.id).join(",")]);

  // Live status while the customer is deciding.
  useEffect(() => {
    if (ro?.status !== "awaiting_customer") return;
    const t = setInterval(() => load(), 2000);
    return () => clearInterval(t);
  }, [ro?.status]);

  useEffect(() => {
    if (prevStatus.current === "awaiting_customer" && ro?.status === "customer_approved") setPhoneKey((k) => k + 1);
    prevStatus.current = ro?.status;
  }, [ro?.status]);

  async function run() {
    setErr("");
    setRunning(true);
    setStep(0);
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, 3)), 450);
    try {
      const r = await api.post<RO>(`/api/ros/${id}/analyze`);
      await new Promise((res) => setTimeout(res, 1400));
      setRo(r);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      clearInterval(timer);
      setStep(4);
      setRunning(false);
    }
  }

  async function approve() {
    if (!ro) return;
    setErr("");
    setApproving(true);
    try {
      const r = await api.post<RO>(`/api/ros/${id}/approve`, {
        approvals: ro.lines.map((l) => ({ line_id: l.id, option_id: sel[l.id], override_reason: reasons[l.id] || null })),
        advisor: ro.advisor,
      });
      setRo(r);
      setPhoneKey((k) => k + 1);
    } catch (e: any) {
      setErr(e.message);
    } finally { setApproving(false); }
  }

  const totals = useMemo(() => {
    if (!ro) return null;
    let pay = 0, newCost = 0, co2 = 0, pts = 0;
    for (const l of ro.lines) {
      const p = l.recommendation?.payload;
      if (!p) continue;
      const o = p.options.find((x) => x.id === sel[l.id]);
      const n = p.options.find((x) => x.id === p.best_new_id)!;
      if (!o) continue;
      pay += o.price;
      newCost += n.price;
      if (o.id !== n.id) {
        const c = n.co2_kg - o.co2_kg;
        co2 += c;
        pts += c > 0 ? Math.round((c * 10) / 10) * 10 : 0;
      }
    }
    return { pay, saved: newCost - pay, co2, pts };
  }, [ro, sel]);

  if (err && !ro) return <div className="text-red-300">{err}</div>;
  if (!ro) return <div className="text-slate-400">Loading…</div>;

  const analysed = ro.lines.length > 0 && ro.lines.every((l) => l.recommendation) && ro.status !== "open";
  const v = ro.vehicle;
  const ctx = v.context;
  const locked = ro.status === "awaiting_customer" || ro.status === "customer_approved";
  const missingReason = ro.lines.some((l) => {
    const rec = l.recommendation?.payload.recommended_id;
    return rec && sel[l.id] && sel[l.id] !== rec && !(reasons[l.id] || "").trim();
  });

  return (
    <div className="fade-in space-y-6">
      <Link to="/ros" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"><ArrowLeft size={14} /> All repair orders</Link>

      {/* Header */}
      <div className="card flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold">{ro.id}</h1>
            <StatusPill s={ro.status} />
          </div>
          <div className="mt-1 text-lg text-slate-200">{v.year} {v.make_model} <span className="text-slate-500">· {v.body}</span></div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="chip bg-ink-800 text-slate-300">{v.km.toLocaleString("en-IN")} km</span>
            <span className="chip bg-ink-800 text-slate-300">{ctx.age_years.toFixed(1)} yrs old</span>
            <span className={`chip ${ctx.factory_warranty_active ? "bg-violet-900/70 text-violet-200" : "bg-ink-800 text-slate-400"}`}>
              Factory warranty {ctx.factory_warranty_active ? `active → ${ctx.factory_warranty_until}` : "over"}
            </span>
            <span className={`chip ${ctx.ext_warranty_active ? "bg-violet-900/70 text-violet-200" : "bg-ink-800 text-slate-400"}`}>
              Extended warranty {ctx.ext_warranty_active ? `active (${ctx.ext_warranty_categories.join(", ")})` : "none"}
            </span>
          </div>
          <div className="mt-2 text-sm text-slate-400">“{ro.complaint}”</div>
        </div>
        <div className="text-right text-sm">
          <div className="text-slate-200">{ro.customer.name}</div>
          <div className="text-slate-500">{ro.customer.phone.replace(/\d(?=\d{4})/g, "•")}</div>
          <div className="mt-1 text-slate-500">Advisor: {ro.advisor} · {ro.rooftop.short}</div>
          <div className="mt-1 inline-flex items-center gap-1 text-mint-400"><Leaf size={13} /> {ro.customer.green_points} Green Points</div>
        </div>
      </div>

      {ro.diagnosis && <DiagnosisCard ro={ro} />}

      {!locked && <LineEditor ro={ro} onChange={setRo} />}

      {/* Pipeline */}
      {(!analysed || running) && (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="font-bold">Run PartWise on this repair order</div>
              <div className="text-sm text-slate-400">Searches new, remanufactured and recycled stock across every rooftop, applies the dealer's rules, scores and explains.</div>
            </div>
            <button onClick={run} disabled={running || ro.lines.length === 0} className={`btn-primary px-6 py-3 text-base ${running || !ro.lines.length ? "" : "pulse-ring"}`}>
              {running ? <Spinner /> : <Zap size={18} />} {running ? "Analysing…" : "Run PartWise"}
            </button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {STEPS.map((s, i) => {
              const state = step > i || step === 4 ? "done" : step === i ? "active" : "idle";
              return (
                <div key={s.label} className={`rounded-xl border p-3 transition ${state === "done" ? "border-mint-600 bg-mint-500/10" : state === "active" ? "border-mint-500 bg-ink-800" : "border-ink-700"}`}>
                  <div className="flex items-center gap-2 font-semibold">
                    {state === "done" ? <CheckCircle2 size={16} className="text-mint-400" /> : state === "active" ? <Spinner /> : <s.icon size={16} className="text-slate-500" />}
                    {s.label}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{s.sub}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {err && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>}

      {analysed && !running && (
        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            {ro.lines.map((l) => (
              <LineCard key={l.id} line={l} selected={sel[l.id]} locked={locked}
                onSelect={(oid) => setSel({ ...sel, [l.id]: oid })}
                reason={reasons[l.id] ?? l.override_reason ?? ""}
                onReason={(t) => setReasons({ ...reasons, [l.id]: t })} />
            ))}
            {!locked && (
              <button onClick={run} className="btn-ghost text-xs"><RefreshCw size={13} /> Re-run with current stock & rules</button>
            )}
          </div>

          {/* Right rail */}
          <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
            {totals && (
              <div className="card p-5">
                <div className="label">Estimate summary (parts)</div>
                <div className="mt-3 space-y-2 text-sm">
                  <Row k="Customer pays" v={inr(totals.pay)} big />
                  <Row k="Saved vs all-new" v={inr(totals.saved)} accent />
                  <Row k="CO₂ avoided" v={`≈${totals.co2.toFixed(1)} kg`} accent />
                  <Row k="Green Points to earn" v={`+${totals.pts}`} accent />
                </div>
                {ro.status === "recommended" && (
                  <>
                    <button onClick={approve} disabled={approving || missingReason} className="btn-primary mt-5 w-full py-3 text-base">
                      {approving ? <Spinner /> : <CheckCircle2 size={18} />} Approve & send to customer
                    </button>
                    {missingReason && <div className="mt-2 text-xs text-amber-300">Add a reason for each override first. It goes to the audit log.</div>}
                    <div className="mt-2 text-center text-xs text-slate-500">Customer gets an SMS link to compare and choose.</div>
                  </>
                )}
              </div>
            )}

            {ro.status === "customer_approved" && (
              <div className="card fade-in border-mint-600 bg-mint-500/10 p-5">
                <div className="flex items-center gap-2 text-lg font-bold text-mint-300"><CheckCircle2 /> Customer approved</div>
                <ul className="mt-3 space-y-2 text-sm">
                  {ro.lines.map((l) => {
                    const o = l.recommendation?.payload.options.find((x) => x.id === l.chosen_option);
                    return o ? (
                      <li key={l.id} className="flex justify-between gap-2"><span>{l.part_name}</span><span className="text-slate-300">{kindLabel[o.kind]} · {inr(o.price)}</span></li>
                    ) : null;
                  })}
                </ul>
                {ro.transfers.length > 0 && (
                  <div className="mt-4 space-y-1 border-t border-mint-700/40 pt-3 text-xs text-slate-300">
                    {ro.transfers.map((t) => (
                      <div key={t.id} className="flex items-center gap-2"><Truck size={13} className="text-mint-400" /> Transfer {t.from_rooftop} → {t.to_rooftop} requested in ARC · fee {inr(t.fee)}</div>
                    ))}
                  </div>
                )}
                <div className="mt-2 text-xs text-slate-400">Choice written back to the ARC repair order. <Link className="text-mint-300 underline" to={`/audit?ro=${ro.id}`}>View audit trail</Link></div>
              </div>
            )}

            {ro.customer_token && (
              <div className="card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="label flex items-center gap-1"><MessageSquare size={13} /> Customer view (live)</div>
                  <a href={`/c/${ro.customer_token}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-mint-300 hover:underline">Open <ExternalLink size={12} /></a>
                </div>
                {ro.sms[0] && (
                  <div className="mb-3 rounded-xl bg-ink-800 p-3 text-xs text-slate-300">
                    <div className="mb-1 flex items-center gap-1 font-semibold text-slate-200"><Send size={12} /> SMS to {ro.sms[0].to_phone.replace(/\d(?=\d{4})/g, "•")} <span className="ml-auto text-slate-500">{ro.sms[0].status}</span></div>
                    {ro.sms[0].body}
                  </div>
                )}
                <div className="mx-auto w-[300px] rounded-[2.2rem] border-[10px] border-ink-700 bg-ink-700 shadow-2xl">
                  <iframe key={phoneKey} src={`/c/${ro.customer_token}?embed=1`} className="h-[600px] w-full rounded-[1.6rem] bg-white" title="Customer phone" />
                </div>
                {ro.status === "awaiting_customer" && (
                  <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-400"><Spinner /> Waiting for the customer to choose…</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DiagnosisCard({ ro }: { ro: RO }) {
  const d = ro.diagnosis!;
  const live = d.mode.startsWith("llm");
  return (
    <div className="card border-mint-700/60 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Smartphone size={16} className="text-mint-400" />
        <div className="font-bold">Booked online: the customer's own words</div>
        <span className={`chip ${live ? "bg-mint-500/15 text-mint-300" : "bg-slate-700/60 text-slate-300"}`}><Sparkles size={11} /> {live ? `AI · ${d.mode.slice(4)}` : `Keyword match`}</span>
      </div>
      {d.voice && (
        <div className="mt-2 flex items-center gap-2 text-xs"><span className="chip bg-sky-400/90 text-ink-950"><Mic size={11} /> VOICE NOTE</span><span className="text-slate-400">heard in {d.voice.language}</span></div>
      )}
      <p className="mt-2 rounded-xl bg-ink-850 p-3 text-sm text-slate-200">“{ro.complaint}”</p>
      {d.voice && !["en", "english"].includes(d.voice.language) && <p className="mt-1 text-sm text-slate-400">English: {d.voice.english}</p>}
      {d.summary && live && <p className="mt-2 text-sm text-slate-400">AI summary: {d.summary}</p>}
      <div className="mt-3 label">Suggested part lines ({d.parts.length})</div>
      {d.parts.length === 0 && <div className="mt-1 text-sm text-amber-300">No part matched the description. Inspect the car and add lines below.</div>}
      <div className="mt-2 space-y-1.5">
        {d.parts.map((p) => (
          <div key={p.part_id} className="flex items-center gap-3 text-sm">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-800"><div className="h-full bg-mint-500" style={{ width: `${p.confidence * 100}%` }} /></div>
            <span className="font-semibold">{p.name}</span>
            <span className="text-xs text-slate-500">{p.reason}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-slate-500">Suggestions only. Confirm after inspection and edit the lines below before running PartWise.</div>
    </div>
  );
}

const CATEGORIES = ["electrical", "hvac", "engine", "transmission", "body", "brakes", "steering", "airbags", "suspension", "tyres", "seatbelts"];

function LineEditor({ ro, onChange }: { ro: RO; onChange: (r: RO) => void }) {
  const [parts, setParts] = useState<Part[]>([]);
  const [add, setAdd] = useState("");
  const [custom, setCustom] = useState(false);
  const [np, setNp] = useState({ name: "", category: "electrical", new_price: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const loadParts = () => api.get<Part[]>("/api/catalog").then((p) => { setParts(p); setAdd((a) => a || p[0]?.id || ""); });
  useEffect(() => { loadParts(); }, []);

  async function act(fn: () => Promise<RO>) {
    setBusy(true); setErr("");
    try { onChange(await fn()); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function addCustom() {
    await act(async () => {
      const p = await api.post<Part>("/api/parts", np);
      await loadParts();
      setCustom(false);
      setNp({ name: "", category: "electrical", new_price: 0 });
      return api.post<RO>(`/api/ros/${ro.id}/lines`, { part_id: p.id });
    });
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-bold">Part lines <span className="text-sm font-normal text-slate-500">· edit before quoting</span></div>
        {busy && <Spinner />}
      </div>
      <div className="space-y-2">
        {ro.lines.length === 0 && <div className="text-sm text-slate-500">No lines yet.</div>}
        {ro.lines.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-3 rounded-xl bg-ink-850 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-semibold">{l.part_name} <span className="text-xs font-normal text-slate-500">· {l.category}{l.safety_critical ? " · safety" : ""} · new {inr(l.new_price)}</span></div>
              <div className="truncate text-xs text-slate-500">{l.labor_desc}</div>
            </div>
            <button disabled={busy} title="Remove line" onClick={() => act(() => api.del<RO>(`/api/ros/${ro.id}/lines/${l.id}`))} className="text-slate-500 hover:text-red-300"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <select className="input min-w-0 flex-1" value={add} onChange={(e) => setAdd(e.target.value)}>
          {parts.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.category}{p.safety_critical ? " · safety" : ""} · {inr(p.new_price)}</option>)}
        </select>
        <button disabled={busy || !add} className="btn-ghost" onClick={() => act(() => api.post<RO>(`/api/ros/${ro.id}/lines`, { part_id: add }))}><Plus size={15} /> Add line</button>
        <button className="btn-ghost" onClick={() => setCustom(!custom)}>Part not listed?</button>
      </div>
      {custom && (
        <div className="mt-3 grid gap-2 rounded-xl border border-ink-700 p-3 sm:grid-cols-[1fr_150px_130px_auto]">
          <input className="input" placeholder="Part name, e.g. Fog lamp" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
          <select className="input" value={np.category} onChange={(e) => setNp({ ...np, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <input className="input" type="number" placeholder="New price ₹" value={np.new_price || ""} onChange={(e) => setNp({ ...np, new_price: +e.target.value })} />
          <button disabled={busy || np.name.trim().length < 2 || np.new_price <= 0} className="btn-primary" onClick={addCustom}>Add</button>
          <div className="text-xs text-slate-500 sm:col-span-4">Safety rules apply by category. CO₂ is estimated from price until an LCA figure exists.</div>
        </div>
      )}
      {err && <div className="mt-2 text-sm text-red-300">{err}</div>}
    </div>
  );
}

function Row({ k, v, accent, big }: { k: string; v: string; accent?: boolean; big?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-slate-400">{k}</span>
      <span className={`${big ? "text-2xl" : "text-base"} font-bold ${accent ? "text-mint-400" : "text-white"}`}>{v}</span>
    </div>
  );
}

function LineCard({ line, selected, locked, onSelect, reason, onReason }: {
  line: Line; selected?: string; locked: boolean; onSelect: (id: string) => void; reason: string; onReason: (t: string) => void;
}) {
  const rec = line.recommendation!;
  const p = rec.payload;
  const [open, setOpen] = useState(p.decision === "RECYCLED_RECOMMENDED");
  const [showFacts, setShowFacts] = useState(false);
  const fixed = p.decision === "NEW_ONLY" || p.decision === "WARRANTY";
  const overridden = selected && selected !== p.recommended_id;
  const sorted = [...p.options].sort((a, b) => (b.eligible ? 1 : 0) - (a.eligible ? 1 : 0) || (b.score ?? -1) - (a.score ?? -1));
  const chosen = line.chosen_option ? p.options.find((o) => o.id === line.chosen_option) : null;

  return (
    <div className={`card fade-in overflow-hidden ${p.decision === "RECYCLED_RECOMMENDED" ? "border-mint-700" : ""}`}>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-bold">{line.part_name}</div>
            <div className="text-xs text-slate-500">{line.labor_desc} · {line.part_id} · {line.category}</div>
          </div>
          <div className="flex items-center gap-2">
            {chosen && <span className="chip bg-mint-500/20 text-mint-300"><CheckCircle2 size={12} /> Customer chose {kindLabel[chosen.kind]}</span>}
            <DecisionChip d={p.decision} />
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-ink-850 p-3">
          <div className="mb-1 flex items-center gap-2"><AiBadge mode={rec.llm_mode} /><span className="text-xs text-slate-500">Rules v{rec.rules_version}</span></div>
          <p className="text-sm leading-relaxed text-slate-200">{rec.explanation.advisor_reason}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {rec.explanation.key_factors.map((f) => <span key={f} className="chip bg-ink-700 text-slate-300">{f}</span>)}
          </div>
        </div>

        {p.decision === "RECYCLED_RECOMMENDED" && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Impact icon={IndianRupee} label="Saves" v={inr(p.savings_inr)} />
            <Impact icon={Leaf} label="CO₂ avoided" v={`≈${p.co2_saved_kg} kg`} />
            <Impact icon={Clock} label="Wait saved" v={`${p.wait_days_saved} day${p.wait_days_saved === 1 ? "" : "s"}`} />
            <Impact icon={ShieldCheck} label="Green Points" v={`+${p.green_points}`} />
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setOpen(!open)} className="btn-ghost px-3 py-1.5 text-xs">
            <ChevronDown size={14} className={`transition ${open ? "rotate-180" : ""}`} /> {p.options.length} option{p.options.length > 1 ? "s" : ""} found across the network
            {p.blocked_alternatives > 0 && <span className="text-slate-500">· {p.blocked_alternatives} blocked by rules</span>}
          </button>
          <button onClick={() => setShowFacts(!showFacts)} className="btn-ghost px-3 py-1.5 text-xs"><Eye size={14} /> What the AI saw</button>
        </div>

        {showFacts && (
          <div className="mt-3 rounded-xl border border-ink-700 bg-ink-950 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs"><span className="chip bg-mint-500/15 text-mint-300"><Lock size={11} /> No customer personal data</span><span className="text-slate-500">Exact JSON sent to the LLM. It can explain, never decide.</span></div>
            <pre className="max-h-72 overflow-auto text-[11px] leading-snug text-slate-300">{JSON.stringify(p.llm_facts, null, 2)}</pre>
          </div>
        )}
      </div>

      {open && (
        <div className="border-t border-ink-700 bg-ink-950/40 p-5">
          <div className="mb-3 space-y-1">
            {p.rule_hits.map((h, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={`chip ${h.outcome === "pass" ? "bg-ink-700 text-slate-300" : "bg-amber-400/90 text-ink-950"}`}>{h.rule}</span>
                <span className="text-slate-400">{h.text}</span>
              </div>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
            {Object.keys(FEATURE_COLORS).map((f) => (
              <span key={f} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${FEATURE_COLORS[f]}`} />{FEATURE_LABEL[f]} {Math.round((p.weights[f] ?? 0) * 100)}%</span>
            ))}
          </div>
          <div className="space-y-2">
            {sorted.map((o) => (
              <OptionRow key={o.id} o={o} selected={selected === o.id}
                disabled={locked || fixed || !o.eligible} onSelect={() => onSelect(o.id)} />
            ))}
          </div>
          {fixed && <div className="mt-3 flex items-center gap-2 text-xs text-slate-400"><Lock size={12} /> Policy decision: this line cannot be overridden.</div>}
        </div>
      )}

      {overridden && !locked && (
        <div className="border-t border-amber-500/30 bg-amber-500/10 p-4">
          <div className="mb-1 text-xs font-semibold text-amber-200">You're overriding the recommendation. Why?</div>
          <input className="input" placeholder="e.g. Customer asked for a new part" value={reason} onChange={(e) => onReason(e.target.value)} />
        </div>
      )}
      {line.override_reason && locked && (
        <div className="border-t border-amber-500/30 bg-amber-500/10 px-5 py-2 text-xs text-amber-200">Advisor override: {line.override_reason}</div>
      )}
    </div>
  );
}

function Impact({ icon: I, label, v }: { icon: any; label: string; v: string }) {
  return (
    <div className="rounded-xl border border-mint-700/50 bg-mint-500/5 p-2.5">
      <div className="flex items-center gap-1 text-[11px] text-slate-400"><I size={12} />{label}</div>
      <div className="font-bold text-mint-300">{v}</div>
    </div>
  );
}

function OptionRow({ o, selected, disabled, onSelect }: { o: Option; selected: boolean; disabled: boolean; onSelect: () => void }) {
  return (
    <label className={`block rounded-xl border p-3 transition ${selected ? "border-mint-500 bg-mint-500/10" : o.eligible ? "border-ink-700 hover:border-ink-600" : "border-ink-800 opacity-60"} ${disabled ? "cursor-default" : "cursor-pointer"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <input type="radio" className="accent-mint-500" checked={selected} disabled={disabled} onChange={onSelect} />
        <KindBadge k={o.kind} grade={o.grade} />
        {o.recommended && <span className="chip bg-mint-500 text-ink-950">PartWise pick</span>}
        <span className="text-sm text-slate-300">{o.rooftop}{o.distance_km > 0 ? ` · ${Math.round(o.distance_km)} km` : o.rooftop_id ? " · this store" : ""}</span>
        <span className="ml-auto text-sm font-bold">{o.kind === "warranty" ? <>₹0 <span className="text-xs font-normal text-slate-500 line-through">{inr(o.list_price ?? 0)}</span></> : inr(o.price)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-7 text-xs text-slate-400">
        <span>{ready(o.wait_days)}</span>
        <span>{o.co2_kg.toFixed(1)} kg CO₂</span>
        <span>{o.warranty_months}-mo warranty</span>
        {o.days_in_stock > 365 && <span className="text-amber-300">idle {Math.round(o.days_in_stock / 30)} months</span>}
        <span className="text-slate-500">{o.source}</span>
      </div>
      {o.eligible && o.score !== null && o.contribution && (
        <div className="mt-2 flex items-center gap-2 pl-7">
          <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-ink-800">
            {Object.entries(o.contribution).map(([f, val]) => (
              <div key={f} className={FEATURE_COLORS[f]} style={{ width: `${val}%` }} title={`${FEATURE_LABEL[f]}: ${val}`} />
            ))}
          </div>
          <span className="w-12 text-right text-xs font-bold text-slate-200">{o.score.toFixed(0)}/100</span>
        </div>
      )}
      {!o.eligible && (
        <div className="mt-1.5 pl-7 text-xs text-red-300/80">Excluded: {o.exclusions.join(" · ")}</div>
      )}
    </label>
  );
}
