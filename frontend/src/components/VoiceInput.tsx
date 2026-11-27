import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";

export interface Transcript { text: string; language: string; english: string; duration_s: number }

const MAX_SECONDS = 90;

function pickMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const m of options) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

/** Tap to record a voice note; it is transcribed (any language) and translated to English. */
export default function VoiceInput({ onTranscript }: { onTranscript: (t: Transcript) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number>();
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  useEffect(() => () => { window.clearInterval(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  async function start() {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => upload(new Blob(chunks.current, { type: r.mimeType || mime || "audio/webm" }));
      r.start();
      rec.current = r;
      setSecs(0);
      setState("recording");
      timer.current = window.setInterval(() => setSecs((s) => {
        if (s + 1 >= MAX_SECONDS) stop();
        return s + 1;
      }), 1000);
    } catch {
      setErr("Microphone permission was blocked. You can type instead.");
    }
  }

  function stop() {
    window.clearInterval(timer.current);
    if (rec.current && rec.current.state !== "inactive") {
      rec.current.stop();
      rec.current.stream.getTracks().forEach((t) => t.stop());
    }
  }

  async function upload(blob: Blob) {
    setState("working");
    try {
      const r = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": blob.type || "audio/webm" }, body: blob });
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "Could not understand the recording");
      if (!j.text) throw new Error("We couldn't hear anything. Try again a little closer to the mic.");
      onTranscript(j);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setState("idle");
    }
  }

  if (!supported) return null;
  return (
    <div className="mb-3">
      {state === "idle" && (
        <button type="button" onClick={start}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#22a971] bg-emerald-50 py-3 text-sm font-semibold text-[#17784f]">
          <Mic size={18} /> Tap to speak: any language
        </button>
      )}
      {state === "recording" && (
        <button type="button" onClick={stop} className="flex w-full items-center justify-center gap-3 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" /> Recording {secs}s · tap to stop <Square size={14} />
        </button>
      )}
      {state === "working" && (
        <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 py-3 text-sm text-slate-600">
          <Loader2 size={16} className="animate-spin" /> Listening to your voice note…
        </div>
      )}
      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
      <div className="mt-1 text-center text-[11px] text-slate-400">Hindi, Kannada, Tamil, English… we'll write it down for you.</div>
    </div>
  );
}
