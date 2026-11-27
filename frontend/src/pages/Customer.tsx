import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Leaf, ShieldCheck, ShieldAlert, Sparkles, CheckCircle2, Gift } from "lucide-react";
import { api } from "../api";
import { inr, ready, kindLabel } from "../ui";

interface COpt {
  id: string; kind: "new" | "remanufactured" | "recycled" | "warranty"; grade: string | null; price: number;
  wait_days: number; warranty_months: number; co2_kg: number; from: string; distance_km: number;
  savings_inr: number; co2_saved_kg: number; wait_days_saved: number; green_points: number;
}
interface CLine { line_id: number; part: string; decision: string; fixed: boolean; recommended_id: string; chosen_id: string | null; message: string; options: COpt[] }
interface CView {
  ro_id: string; status: string; dealer: string; vehicle: string; customer_first_name: string; green_points: number;
  reward_threshold: number; reward_name: string; lines: CLine[]; ledger: { points: number; co2_kg: number; note: string; created_at: string }[];
  complaint?: string; summary?: string | null; suspected?: string[]; rooftops?: number;
}

export default function Customer() {
  const { token } = useParams();
  const [v, setV] = useState<CView | null>(null);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [earned, setEarned] = useState<{ points: number; co2: number } | null>(null);

  const load = () => api.get<CView>(`/api/customer/${token}`).then((d) => {
    setV(d);
    setPick(Object.fromEntries(d.lines.map((l) => [l.line_id, l.chosen_id ?? l.recommended_id])));
  }).catch((e) => setErr(e.message));

  useEffect(() => { document.title = "Your repair estimate"; load(); }, [token]);

  // While the advisor reviews, keep checking so the estimate appears by itself.
  useEffect(() => {
    if (v?.status !== "reviewing") return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [v?.status]);

  async function confirm() {
    setBusy(true);
    try {
      const r = await api.post<{ points_awarded: number; co2_saved_kg: number; view: CView }>(`/api/customer/${token}/choose`, { choices: pick });
      setEarned({ points: r.points_awarded, co2: r.co2_saved_kg });
      setV(r.view);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (err) return <Shell><div className="p-6 text-center text-slate-600">{err}</div></Shell>;
  if (!v) return <Shell><div className="p-6 text-center text-slate-500">Loading your estimate…</div></Shell>;

  if (v.status === "reviewing") return (
    <Shell>
      <div className="bg-[#0f1916] px-5 pb-6 pt-7 text-white">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#5ee3a8]">{v.dealer}</div>
        <div className="mt-1 text-2xl font-bold">Thanks, {v.customer_first_name}!</div>
        <div className="text-sm text-slate-300">Request {v.ro_id} · {v.vehicle}</div>
      </div>
      <div className="-mt-3 space-y-4 rounded-t-3xl bg-slate-50 px-4 pb-8 pt-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[#22a971] border-t-transparent" />
            <div className="font-bold text-slate-900">Your advisor is preparing your estimate</div>
          </div>
          <div className="mt-2 text-sm text-slate-600">We're checking new, remanufactured and recycled parts across all {v.rooftops} Apex Motors stores. This page updates by itself, and we'll also text you.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">You told us</div>
          <div className="mt-1 text-sm text-slate-700">“{v.complaint}”</div>
          {v.suspected && v.suspected.length > 0 ? (
            <>
              <div className="mt-3 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-400"><Sparkles size={12} /> Likely parts to check</div>
              <div className="mt-1 flex flex-wrap gap-1.5">{v.suspected.map((p, i) => <span key={i} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-[#17784f]">{p}</span>)}</div>
              <div className="mt-2 text-[11px] text-slate-400">A technician confirms before anything is quoted.</div>
            </>
          ) : <div className="mt-3 text-sm text-slate-500">A technician will inspect your car to find the cause.</div>}
        </div>
        <div className="rounded-2xl bg-[#0f1916] p-4 text-white">
          <div className="flex items-center justify-between"><div className="font-bold text-[#5ee3a8]">{v.green_points} Green Points</div><Leaf className="text-[#5ee3a8]" /></div>
          <div className="text-xs text-slate-400">Choose greener parts to earn points toward: {v.reward_name}</div>
        </div>
      </div>
    </Shell>
  );

  const done = v.status === "customer_approved";
  const total = v.lines.reduce((s, l) => s + (l.options.find((o) => o.id === pick[l.line_id])?.price ?? 0), 0);
  const pendingPts = v.lines.reduce((s, l) => s + (l.options.find((o) => o.id === pick[l.line_id])?.green_points ?? 0), 0);
  const pts = v.green_points;
  const toward = pts % v.reward_threshold;
  const rewards = Math.floor(pts / v.reward_threshold);

  return (
    <Shell>
      <div className="bg-[#0f1916] px-5 pb-6 pt-7 text-white">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#5ee3a8]">{v.dealer}</div>
        <div className="mt-1 text-2xl font-bold">Hi {v.customer_first_name} 👋</div>
        <div className="text-sm text-slate-300">Your {v.vehicle} estimate · {v.ro_id}</div>
      </div>

      <div className="-mt-3 space-y-4 rounded-t-3xl bg-slate-50 px-4 pb-8 pt-5">
        {done && earned && earned.points > 0 && (
          <div className="fade-in rounded-2xl bg-[#17784f] p-4 text-center text-white">
            <div className="text-3xl font-extrabold">+{earned.points} Green Points</div>
            <div className="text-sm text-emerald-100">You avoided ≈{earned.co2} kg of CO₂ with this repair. Thank you!</div>
          </div>
        )}
        {done && (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 size={18} /> Confirmed. Your advisor has your choices and the work is scheduled.
          </div>
        )}

        {v.lines.map((l) => (
          <div key={l.line_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {l.fixed ? (
              <>
                <div className="flex items-center justify-between">
                  <div className="text-lg font-bold text-slate-900">{l.part}</div>
                  {l.decision === "WARRANTY"
                    ? <span className="chip bg-violet-100 text-violet-700"><ShieldCheck size={12} /> Covered</span>
                    : <span className="chip bg-sky-100 text-sky-700"><ShieldAlert size={12} /> Safety part</span>}
                </div>
                <div className="mt-1 text-sm text-slate-600">{l.message}</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{l.decision === "WARRANTY" ? "₹0 · warranty-approved part" : `New part · ${inr(l.options[0].price)}`}</div>
              </>
            ) : (
              <>
                <div className="text-lg font-bold text-slate-900">Your {l.part.toLowerCase()}: {l.options.length} options</div>
                <div className="mt-3 space-y-2">
                  {l.options.map((o) => {
                    const on = pick[l.line_id] === o.id;
                    const rec = o.id === l.recommended_id;
                    const green = o.kind !== "new";
                    return (
                      <button key={o.id} disabled={done}
                        onClick={() => setPick({ ...pick, [l.line_id]: o.id })}
                        className={`w-full rounded-xl border-2 p-3 text-left transition ${on ? (green ? "border-[#22a971] bg-emerald-50" : "border-slate-800 bg-slate-50") : "border-slate-200 bg-white"}`}>
                        <div className="flex items-center justify-between">
                          <div className="font-bold text-slate-900">{kindLabel[o.kind]}{o.grade ? ` (grade ${o.grade})` : ""} · {inr(o.price)}</div>
                          <div className={`h-5 w-5 rounded-full border-2 ${on ? "border-[#22a971] bg-[#22a971]" : "border-slate-300"}`} />
                        </div>
                        <div className="text-sm text-slate-600">
                          {ready(o.wait_days)} · {o.warranty_months}-month warranty{green ? ` · ≈${o.co2_saved_kg} kg CO₂ saved` : ""}
                        </div>
                        {rec && o.savings_inr > 0 && <div className="mt-1 text-sm font-bold text-[#17784f]">Recommended · saves {inr(o.savings_inr)}</div>}
                        {rec && o.savings_inr <= 0 && <div className="mt-1 text-sm font-bold text-slate-700">Recommended</div>}
                        {o.green_points > 0 && <div className="mt-1 text-xs font-semibold text-[#22a971]">+{o.green_points} Green Points</div>}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-slate-700">
                  <span className="inline-flex items-center gap-1 font-bold text-[#17784f]"><Sparkles size={13} /> Why:</span> {l.message}
                </div>
              </>
            )}
          </div>
        ))}

        {!done && (
          <div className="sticky bottom-3 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-slate-200">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-slate-500">Parts total</span>
              <span className="text-lg font-bold text-slate-900">{inr(total)}</span>
            </div>
            <button onClick={confirm} disabled={busy} className="w-full rounded-xl bg-[#17784f] py-3 text-base font-bold text-white disabled:opacity-60">
              {busy ? "Confirming…" : `Confirm my choices${pendingPts ? ` · +${pendingPts} pts` : ""}`}
            </button>
          </div>
        )}

        <div className="rounded-2xl bg-[#0f1916] p-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-bold text-[#5ee3a8]">{pts} Green Points</div>
              <div className="text-sm text-slate-300">{toward} / {v.reward_threshold} to your next reward</div>
            </div>
            <Leaf className="text-[#5ee3a8]" size={30} />
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-700">
            <div className="h-full rounded-full bg-[#3ecf8e] transition-all duration-1000" style={{ width: `${(toward / v.reward_threshold) * 100}%` }} />
          </div>
          <div className="mt-2 flex items-center gap-1 text-xs text-slate-400"><Gift size={12} /> {v.reward_name}{rewards > 0 ? ` · ${rewards} reward${rewards > 1 ? "s" : ""} unlocked!` : ""}</div>
        </div>

        <div className="text-center text-[11px] text-slate-400">Recycled & remanufactured parts are tested and carry a written warranty. Safety parts are always new.</div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-full bg-slate-50"><div className="mx-auto max-w-md">{children}</div></div>;
}
