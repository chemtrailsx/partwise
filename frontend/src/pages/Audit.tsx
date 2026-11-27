import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ScrollText } from "lucide-react";
import { api } from "../api";

interface Ev { id: number; ts: string; ro_id: string | null; actor: string; event: string; detail: Record<string, any> }

const COLOR: Record<string, string> = {
  RULES_EVALUATED: "bg-amber-400/90 text-ink-950",
  OPTIONS_SCORED: "bg-sky-400/90 text-ink-950",
  EXPLANATION_GENERATED: "bg-mint-500/20 text-mint-300",
  ADVISOR_APPROVED: "bg-mint-500 text-ink-950",
  ADVISOR_OVERRIDE: "bg-orange-400 text-ink-950",
  SMS_SENT: "bg-slate-600 text-white",
  CUSTOMER_CHOSE: "bg-mint-500 text-ink-950",
  TRANSFER_REQUESTED: "bg-violet-400 text-ink-950",
  ARC_WRITEBACK: "bg-violet-900 text-violet-100",
  POINTS_AWARDED: "bg-emerald-300 text-ink-950",
  RULES_PUBLISHED: "bg-amber-300 text-ink-950",
};

function summary(e: Ev): string {
  const d = e.detail;
  switch (e.event) {
    case "RULES_EVALUATED": return `${d.part}: ${d.hits.map((h: any) => `${h.rule} ${h.outcome}`).join(", ")} (rules v${d.rules_version})`;
    case "OPTIONS_SCORED": return `${d.part}: ` + d.scores.map((s: any) => `${s.type}@${s.from} ${s.eligible ? s.score : "excluded"}`).join(" · ");
    case "EXPLANATION_GENERATED": return `line ${d.line} · mode ${d.mode} · PII sent to LLM: ${d.llm_input_has_pii ? "yes" : "none"}`;
    case "ADVISOR_APPROVED": return `${d.part} → ${d.option}`;
    case "ADVISOR_OVERRIDE": return `${d.part}: picked ${d.option} over ${d.recommended}. Reason: “${d.reason}”`;
    case "CUSTOMER_CHOSE": return `${d.part} → ${d.type} (saves ₹${d.savings_inr.toLocaleString("en-IN")}, ${d.co2_saved_kg} kg CO₂)`;
    case "TRANSFER_REQUESTED": return `${d.part}: ${d.from} → ${d.to}, fee ₹${d.fee}`;
    case "ARC_WRITEBACK": return `${d.endpoint} · ${d.part_source} · ₹${d.price.toLocaleString("en-IN")}`;
    case "POINTS_AWARDED": return `+${d.points} points for ${d.co2_kg} kg CO₂ avoided`;
    default: return JSON.stringify(d);
  }
}

export default function Audit() {
  const [sp, setSp] = useSearchParams();
  const ro = sp.get("ro") ?? "";
  const [evs, setEvs] = useState<Ev[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => { api.get<Ev[]>(`/api/audit${ro ? `?ro_id=${ro}` : ""}`).then(setEvs); }, [ro]);

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">Every rule hit, score and approval</div>
          <h1 className="mt-1 text-3xl font-extrabold">Audit log</h1>
        </div>
        <input className="input w-60" placeholder="Filter by RO, e.g. RO-24817" defaultValue={ro}
          onKeyDown={(e) => { if (e.key === "Enter") setSp((e.target as HTMLInputElement).value ? { ro: (e.target as HTMLInputElement).value.trim() } : {}); }} />
      </div>
      <div className="card divide-y divide-ink-800">
        {!evs && <div className="p-5 text-slate-400">Loading…</div>}
        {evs?.length === 0 && <div className="flex items-center gap-2 p-5 text-slate-400"><ScrollText size={16} /> No events yet. Run PartWise on a repair order.</div>}
        {evs?.map((e) => (
          <button key={e.id} onClick={() => setOpen(open === e.id ? null : e.id)} className="block w-full px-4 py-3 text-left hover:bg-ink-850">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="w-36 shrink-0 font-mono text-xs text-slate-500">{e.ts.replace("T", " ")}</span>
              <span className={`chip ${COLOR[e.event] ?? "bg-ink-700 text-slate-300"}`}>{e.event}</span>
              {e.ro_id && <span className="text-xs font-semibold text-slate-300">{e.ro_id}</span>}
              <span className="text-xs text-slate-500">{e.actor}</span>
              <span className="min-w-0 flex-1 truncate text-slate-300">{summary(e)}</span>
            </div>
            {open === e.id && <pre className="mt-2 overflow-auto rounded-lg bg-ink-950 p-3 text-[11px] text-slate-300">{JSON.stringify(e.detail, null, 2)}</pre>}
          </button>
        ))}
      </div>
    </div>
  );
}
