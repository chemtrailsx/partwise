import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Leaf, Sparkles, Wrench, Lock, Mic } from "lucide-react";
import { api, type Meta } from "../api";
import VoiceInput, { type Transcript } from "../components/VoiceInput";

const CATS = [
  ["engine", "Engine"], ["electrical", "Electrical"], ["hvac", "AC / heating"], ["transmission", "Gearbox"], ["body", "Body"],
] as const;

const EXAMPLES = [
  "My car won't start in the morning, I hear a clicking sound. The battery light also came on yesterday.",
  "AC is blowing warm air and the engine temperature goes up in traffic.",
  "There's a squealing noise when I brake and the steering feels heavy.",
];

const THIS_YEAR = new Date().getFullYear();

export default function Book() {
  const nav = useNavigate();
  const [f, setF] = useState({
    customer_name: "", phone: "+91 ", make_model: "", body: "hatchback", year: THIS_YEAR - 5, km: 60000,
    factory_warranty_until: "", ext_warranty_active: false, ext_warranty_until: "", ext_warranty_categories: [] as string[],
  });
  const [complaint, setComplaint] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [voiceOn, setVoiceOn] = useState(false);
  const [voice, setVoice] = useState<Transcript | null>(null);

  useEffect(() => {
    document.title = "Book a service · Apex Motors";
    api.get<Meta>("/api/meta").then((m) => setVoiceOn(!!m.voice)).catch(() => setVoiceOn(false));
  }, []);

  const isEnglish = !voice || ["en", "english"].includes(voice.language);

  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const phoneOk = f.phone.replace(/\D/g, "").length >= 10;
  const ready = f.customer_name.trim() && phoneOk && f.make_model.trim() && f.year >= 1990 && f.year <= THIS_YEAR + 1 && f.km >= 0 && complaint.trim().length >= 5
    && (!f.ext_warranty_active || f.ext_warranty_until);

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      const r = await api.post<{ token: string }>("/api/intake", {
        vehicle: { ...f, factory_warranty_until: f.factory_warranty_until || null, ext_warranty_until: f.ext_warranty_active ? f.ext_warranty_until : null },
        complaint,
        voice: !!voice,
        language: voice?.language ?? null,
        complaint_en: voice && !isEnglish && voice.text === complaint ? voice.english : null,
      });
      nav(`/c/${r.token}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-md">
        <div className="bg-[#0f1916] px-5 pb-8 pt-7 text-white">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[#5ee3a8]"><Leaf size={14} /> Apex Motors · Book a service</div>
          <div className="mt-2 text-2xl font-bold">What's wrong with your car?</div>
          <div className="mt-1 text-sm text-slate-300">Tell us in your own words. We'll check parts across all our stores and send you options, including cheaper, greener ones where they're safe.</div>
        </div>

        <div className="-mt-4 space-y-4 rounded-t-3xl bg-slate-50 px-4 pb-10 pt-5">
          <Card title="Describe the problem" icon={<Wrench size={16} />}>
            {voiceOn && <VoiceInput onTranscript={(t) => { setVoice(t); setComplaint(t.text); }} />}
            {voice && (
              <div className="mb-2 rounded-xl bg-emerald-50 p-2.5 text-xs text-slate-600">
                <div className="flex items-center gap-1 font-semibold text-[#17784f]"><Mic size={12} /> Voice note · heard in {voice.language}</div>
                {!isEnglish && voice.text === complaint && <div className="mt-1"><span className="font-semibold">English:</span> {voice.english}</div>}
                <div className="mt-1 text-slate-400">Check the text below and fix anything we misheard.</div>
              </div>
            )}
            <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={5} maxLength={2000}
              placeholder="e.g. The car makes a clicking noise and won't start…"
              className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm outline-none focus:border-[#22a971]" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((e, i) => (
                <button key={i} type="button" onClick={() => setComplaint(e)} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-emerald-50">Example {i + 1}</button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-500"><Sparkles size={11} /> AI suggests likely parts; a technician confirms before any quote.</div>
          </Card>

          <Card title="Your car">
            <div className="grid grid-cols-2 gap-3">
              <In label="Make & model" span><input className="inp" placeholder="e.g. Hyundai i20" value={f.make_model} onChange={(e) => set("make_model", e.target.value)} /></In>
              <In label="Year"><input type="number" className="inp" value={f.year} onChange={(e) => set("year", +e.target.value)} /></In>
              <In label="Odometer (km)"><input type="number" className="inp" value={f.km} onChange={(e) => set("km", +e.target.value)} /></In>
              <In label="Body type" span>
                <select className="inp" value={f.body} onChange={(e) => set("body", e.target.value)}>{["hatchback", "sedan", "SUV", "MUV"].map((b) => <option key={b}>{b}</option>)}</select>
              </In>
              <In label="Factory warranty ends (leave blank if unsure)" span><input type="date" className="inp" value={f.factory_warranty_until} onChange={(e) => set("factory_warranty_until", e.target.value)} /></In>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[#22a971]" checked={f.ext_warranty_active} onChange={(e) => set("ext_warranty_active", e.target.checked)} /> I have an extended warranty</label>
            {f.ext_warranty_active && (
              <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3">
                <In label="Extended warranty ends"><input type="date" className="inp" value={f.ext_warranty_until} onChange={(e) => set("ext_warranty_until", e.target.value)} /></In>
                <div className="text-xs font-semibold text-slate-500">It covers</div>
                <div className="flex flex-wrap gap-2">
                  {CATS.map(([k, l]) => (
                    <label key={k} className="flex items-center gap-1 text-xs">
                      <input type="checkbox" className="accent-[#22a971]" checked={f.ext_warranty_categories.includes(k)}
                        onChange={(e) => set("ext_warranty_categories", e.target.checked ? [...f.ext_warranty_categories, k] : f.ext_warranty_categories.filter((x) => x !== k))} />{l}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card title="Your details">
            <div className="space-y-3">
              <In label="Name"><input className="inp" value={f.customer_name} onChange={(e) => set("customer_name", e.target.value)} /></In>
              <In label="Mobile (we'll text your estimate here)"><input className="inp" inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></In>
            </div>
            <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-500"><Lock size={11} /> Your name and number are never sent to the AI.</div>
          </Card>

          {err && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</div>}
          <button onClick={submit} disabled={!ready || busy} className="w-full rounded-xl bg-[#17784f] py-3.5 text-base font-bold text-white disabled:opacity-50">
            {busy ? "Sending…" : "Send to my service advisor"}
          </button>
        </div>
      </div>
      <style>{`.inp{width:100%;border-radius:.75rem;border:1px solid #cbd5e1;background:#fff;padding:.55rem .75rem;font-size:.875rem;outline:none;color:#0f172a}.inp:focus{border-color:#22a971}`}</style>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 font-bold text-slate-900">{icon}{title}</div>
      {children}
    </div>
  );
}

function In({ label, span, children }: { label: string; span?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${span ? "col-span-2" : ""}`}>
      <div className="mb-1 text-xs font-semibold text-slate-500">{label}</div>
      {children}
    </label>
  );
}
