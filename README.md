# PartWise: AI advisor for cheaper and greener repairs

Team WinxClub · Tekion Tek-Qubit Hackathon · Theme 4: Sustainability

A customer books online and describes the problem in their own words. AI turns that description into suggested part lines, and the advisor confirms or edits them. When a part line is added to a repair order in Tekion ARC, PartWise searches new, remanufactured and recycled stock across **every rooftop in the dealer group**. It applies hard safety and warranty rules, scores the remaining options on price, wait, CO₂, warranty and car age, and explains the pick in plain language. The advisor approves in one click and the customer chooses on their phone. The choice is written back to ARC, a store-to-store transfer is requested, and the customer earns Green Points.

## Run it

Needs Python 3.10+ and Node 18+.

```powershell
pip install -r backend/requirements.txt
./run.ps1
```

Open http://localhost:8000. The first run builds the React app.

**Free AI key (optional, recommended):** copy `backend/.env.example` to `backend/.env`, paste a free key, and restart. Groq is the default (model `openai/gpt-oss-120b`; if Groq retires a model, PartWise switches to one the key can use): sign up at https://console.groq.com/keys (no card needed). Gemini, Cohere and OpenRouter keys also work; use only one. The key powers two things: turning the customer's own words into suggested parts, and writing the plain-language explanations. Without a key, a keyword matcher and a grounded template take over, so everything still works. The sidebar shows which mode is active.

**Real SMS (optional):** set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM`. Without them, messages go to the in-app outbox and the phone preview.

**Dev mode (hot reload):** `python -m uvicorn --app-dir backend app.main:app --reload` and `npm run dev` in `frontend/` (opens on :5173 and proxies `/api`).

## Live deployment (Vercel)

Live at **https://partwise-ten.vercel.app** (customer booking at `/book`).

- `api/index.py` + `vercel.json`: one Python function serves the API and the prebuilt React app (`frontend/dist`, built locally before `vercel deploy --prod`).
- `GROQ_API_KEY` is an encrypted Vercel environment variable.
- **Durable data:** serverless disks are temporary, so `backend/app/blobstore.py` keeps a snapshot of the SQLite file in a *private* Vercel Blob store (`BLOB_READ_WRITE_TOKEN`). It restores on cold start, uploads after every write, and reloads when a request asks for a repair order another instance created. Locally (no token) it does nothing.

**Auto-deploy:** every push to `main` on GitHub builds and deploys to production automatically (Vercel builds the React app and the Python API itself). Pushes to other branches get their own preview URL. Manual fallback: `vercel deploy --prod`.

## Deploy elsewhere (Docker)

The repo includes a `Dockerfile` (builds the React app, serves everything from FastAPI) and a `render.yaml` blueprint.

1. On https://render.com, choose **New → Blueprint** and pick this GitHub repo.
2. When it asks for `GROQ_API_KEY`, paste your key. Keys live only in the host's settings, never in git.
3. Deploy. The app runs at `https://partwise-xxxx.onrender.com`, and customers book at `/book`.

Any Docker host works the same way (Railway, Fly.io, Google Cloud Run): `docker build -t partwise . && docker run -p 8000:8000 -e GROQ_API_KEY=... partwise`. On free plans the SQLite demo data resets when the instance restarts; use **Reset demo data** before presenting.

## What's in the prototype

| Screen | What it does |
|---|---|
| **Customer booking** (`/book`, also linked in the sidebar) | The customer can **tap to speak in any language** (Hindi, Kannada, Tamil, English…). Groq Whisper transcribes the voice note and translates it to English for part matching; the audio isn't stored. Or they type: they enter their name, mobile, car (model, year, km, body), warranty (blank if unsure) and describes the problem in plain words. AI suggests likely parts; name and phone are never sent to the AI. They get a tracking link that says "your advisor is preparing your estimate" and turns into the estimate by itself once it's approved. |
| **Advisor Console** | Repair orders from ARC (mock) plus online bookings (refreshes every 5 s). Online bookings show the customer's words and the AI's suggested parts with confidence. The advisor edits lines: remove, add from the catalog, or add a part that isn't listed (name, category, price; safety rules apply by category). *Run PartWise* shows the pipeline (stock search → rules → scoring → AI). Each line shows the decision, the AI reason, the impact (₹, CO₂, wait, points) and every option in the network with a score breakdown or the reason it was excluded. The advisor can override; an override needs a reason, which is audited. *Approve & send* texts the customer and shows their phone live. |
| **Customer app** (`/c/<token>`) | Mobile page from the SMS link: compare options, see why, choose, and earn Green Points toward a reward. |
| **Impact Dashboard** | The four pilot metrics (recycled uptake, ₹ saved per RO, wait days avoided, kg CO₂ avoided), trends, per-rooftop and per-category views, and the "three winners" business case (customer, dealer group, Tekion). Exports a CO₂ report as CSV. |
| **Parts Network** | Rooftop map with the transfer radius, idle (12+ month) stock value per store, transfers PartWise requested, and a searchable inventory. |
| **Learned weights** (top of Rules & What-if) | Every time a customer is offered a recycled part next to a new one, PartWise records how much better the green option was on price, wait, CO₂, warranty and car-age fit, and whether they took it. A NumPy logistic regression (Newton's method) shows which factors really drive acceptance, its prediction accuracy against a baseline, and suggested weights blended with the policy in proportion to the evidence. Learning never lowers the CO₂ weight. **Try in What-if** previews the effect; **Publish** creates an audited rules version. The 90-day history is a simulated pilot (labelled as such); live customer choices are added as they happen. |
| **Rules & What-if** | Versioned `rules.yaml` validated by Pydantic. Weight sliders re-score a real RO live and highlight picks that change before you publish. |
| **Audit Log** | Every rule hit, score, AI call (PII: none), approval, override, SMS, customer choice, transfer and ARC write-back. |
| **New repair order** | Create any RO (existing or new customer/vehicle, any parts) and run PartWise on it. |

## From the customer's words to part lines (`backend/app/diagnose.py`)

The LLM gets the complaint text, the car (model, year, km) and the parts catalog, and returns suggested part IDs with confidence and reason. Any ID that isn't in the catalog is dropped. Without a key, a regex keyword matcher maps phrases like "won't start, clicking" → starter motor, or "AC blowing warm air" → AC compressor. Suggestions are never quoted directly: the advisor confirms them first.

## How it decides (`backend/app/engine.py`)

1. **Rules engine.** A safety-critical category means a new part only (SAFETY-01). An active factory warranty (WAR-01) or a covering extended warranty (WAR-02) means the warranty-approved part at ₹0.
2. **Eligibility.** A recycled or reman part must meet the minimum grade, the transfer radius and the minimum warranty, must not go on a car under the young-car age, and must be cheaper *and* greener than the best new option.
3. **Scoring (NumPy).** Each feature is min-max normalised across candidates and weighted (price 35, wait 20, CO₂ 25, warranty 10, car-age fit 10 by default). The highest score wins.
4. **AI explainer.** A free-tier LLM (Groq `openai/gpt-oss-120b` by default, JSON output, see `backend/app/llm.py`) gets only the decision data, never the customer's name, phone or VIN. A grounding guard rejects any ₹ figure that isn't in the facts and falls back to the template. The LLM explains; it never decides. Click *What the AI saw* on any line to see the exact payload.

CO₂ model: reman = 18% of new (BORG LCA), tested recycled = 8% of new, plus 0.15 kg/km for the transfer and 2 kg of inbound freight for a factory order. All of these are configurable in YAML.

## Prototype vs production

| Deck stack | Prototype |
|---|---|
| React, TypeScript, Tailwind | Same |
| FastAPI, Pydantic, YAML rules, NumPy | Same |
| LLM API, JSON output | Any free OpenAI-compatible API (Groq / Gemini / Cohere / OpenRouter) over plain HTTPS, no SDK; keyword matcher and grounded template as fallback |
| PostgreSQL, Redis cache | SQLite, with an LLM-response cache table (single-file demo) |
| Tekion APIs | Mock ARC data; write-backs are logged as `PATCH /arc/v1/...` audit events |
| Twilio | Real when env vars are set, otherwise an in-app outbox |

All dealer, customer and stock data is illustrative sample data. **Reset demo data** (sidebar) restores the starting state.
