"""PartWise API (FastAPI). Serves the built React app too, so one process runs the demo."""
from __future__ import annotations

import base64
import json
import os
import secrets
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError, field_validator

from . import db, diagnose, engine, explainer, llm, seed
from .rules import RuleSet, Weights, parse_rules, set_version

app = FastAPI(title="PartWise API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

SUBSCRIPTION_PER_ROOFTOP_INR = 15000  # Tekion ARC add-on, per month


@app.on_event("startup")
def _startup():
    seed.ensure_seeded()


# ---------------------------------------------------------------- helpers
def current_rules() -> RuleSet:
    r = db.row("SELECT yaml FROM rules_versions ORDER BY version DESC LIMIT 1")
    return parse_rules(r["yaml"])


def home_rooftop() -> dict:
    return db.row("SELECT * FROM rooftops WHERE is_home=1")


def get_vehicle(vid: str) -> dict:
    v = db.row("SELECT * FROM vehicles WHERE id=?", (vid,))
    v["ext_warranty_categories"] = json.loads(v["ext_warranty_categories"] or "[]")
    return v


def latest_rec(line_id: int) -> dict | None:
    r = db.row("SELECT * FROM recommendations WHERE ro_line_id=? ORDER BY id DESC LIMIT 1", (line_id,))
    if r:
        r["payload"] = json.loads(r["payload"])
        r["explanation"] = json.loads(r["explanation"])
    return r


def ro_detail(ro_id: str) -> dict:
    ro = db.row("SELECT * FROM repair_orders WHERE id=?", (ro_id,))
    if not ro:
        raise HTTPException(404, "Repair order not found")
    v = get_vehicle(ro["vehicle_id"])
    cust = db.row("SELECT * FROM customers WHERE id=?", (v["customer_id"],))
    lines = db.rows(
        "SELECT l.*, p.name AS part_name, p.category, p.safety_critical, p.new_price, p.labor_hours "
        "FROM ro_lines l JOIN parts p ON p.id=l.part_id WHERE ro_id=? ORDER BY l.id", (ro_id,))
    for l in lines:
        l["recommendation"] = latest_rec(l["id"])
    ro["diagnosis"] = json.loads(ro["diagnosis"]) if ro.get("diagnosis") else None
    ro["vehicle"] = {**v, "context": engine.vehicle_context(v)}
    ro["customer"] = cust
    ro["lines"] = lines
    ro["rooftop"] = db.row("SELECT * FROM rooftops WHERE id=?", (ro["rooftop_id"],))
    ro["transfers"] = db.rows("SELECT * FROM transfers WHERE ro_id=? ORDER BY id", (ro_id,))
    ro["sms"] = db.rows("SELECT * FROM sms_outbox WHERE ro_id=? ORDER BY id DESC", (ro_id,))
    return ro


def analyze_ro(ro_id: str, actor: str = "PartWise engine") -> dict:
    ro = db.row("SELECT * FROM repair_orders WHERE id=?", (ro_id,))
    if not ro:
        raise HTTPException(404, "Repair order not found")
    if ro["status"] in ("customer_approved", "closed"):
        raise HTTPException(409, "Customer has already decided on this repair order")
    rules = current_rules()
    vehicle = get_vehicle(ro["vehicle_id"])
    rooftops = db.rows("SELECT * FROM rooftops")
    home = db.row("SELECT * FROM rooftops WHERE id=?", (ro["rooftop_id"],))
    lines = db.rows("SELECT * FROM ro_lines WHERE ro_id=?", (ro_id,))
    if not lines:
        raise HTTPException(422, "Add at least one part line before running PartWise")
    results = []
    for l in lines:
        part = db.row("SELECT * FROM parts WHERE id=?", (l["part_id"],))
        payload = engine.analyze_line(part, vehicle, home, rooftops, rules)
        expl, mode, facts = explainer.explain(payload)
        payload["llm_facts"] = facts
        results.append((l, payload, expl, mode))
    with db.tx() as c:
        for l, payload, expl, mode in results:
            c.execute(
                "INSERT INTO recommendations (ro_line_id, rules_version, decision, payload, explanation, llm_mode, created_at) VALUES (?,?,?,?,?,?,?)",
                (l["id"], rules.version, payload["decision"], json.dumps(payload, ensure_ascii=False),
                 json.dumps(expl, ensure_ascii=False), mode, db.now()))
            c.execute("UPDATE ro_lines SET status='recommended', approved_option=NULL, override_reason=NULL WHERE id=?", (l["id"],))
            db.audit(c, ro_id, actor, "RULES_EVALUATED", {"line": l["id"], "part": payload["part"]["name"], "rules_version": rules.version, "hits": payload["rule_hits"]})
            db.audit(c, ro_id, actor, "OPTIONS_SCORED", {
                "line": l["id"], "part": payload["part"]["name"], "weights": payload["weights"],
                "scores": [{"option": o["id"], "type": o["kind"], "from": o["rooftop"], "score": o["score"], "eligible": o["eligible"], "excluded": o["exclusions"]} for o in payload["options"]]})
            db.audit(c, ro_id, "AI explainer", "EXPLANATION_GENERATED", {"line": l["id"], "mode": mode, "llm_input_has_pii": False})
        c.execute("UPDATE repair_orders SET status='recommended' WHERE id=?", (ro_id,))
    return ro_detail(ro_id)


def send_sms(to: str, body: str) -> str:
    """Twilio when configured; otherwise the message lands in the demo outbox."""
    sid, token, frm = (os.environ.get(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"))
    if not (sid and token and frm):
        return "simulated"
    try:
        data = urllib.parse.urlencode({"To": to.replace(" ", ""), "From": frm, "Body": body}).encode()
        req = urllib.request.Request(f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json", data=data)
        req.add_header("Authorization", "Basic " + base64.b64encode(f"{sid}:{token}".encode()).decode())
        urllib.request.urlopen(req, timeout=10)
        return "sent via Twilio"
    except Exception as e:
        return f"twilio failed ({type(e).__name__}), kept in outbox"


# ---------------------------------------------------------------- meta
@app.get("/api/meta")
def meta():
    rules = current_rules()
    return {
        "dealer_group": "Apex Motors Group",
        "home": home_rooftop(),
        "rooftops": db.rows("SELECT * FROM rooftops"),
        "llm": llm.info(),
        "rules_version": rules.version,
        "twilio": bool(os.environ.get("TWILIO_ACCOUNT_SID")),
    }


@app.post("/api/admin/reset")
def reset_demo():
    db.reset()
    seed.seed()
    return {"ok": True}


# ---------------------------------------------------------------- repair orders
@app.get("/api/ros")
def list_ros():
    ros = db.rows(
        "SELECT r.*, v.make_model, v.year, v.km, c.name AS customer_name "
        "FROM repair_orders r JOIN vehicles v ON v.id=r.vehicle_id JOIN customers c ON c.id=v.customer_id "
        "ORDER BY r.created_at DESC")
    for r in ros:
        lines = db.rows("SELECT l.id, p.name FROM ro_lines l JOIN parts p ON p.id=l.part_id WHERE ro_id=?", (r["id"],))
        r["parts"] = [l["name"] for l in lines]
        decisions = [latest_rec(l["id"]) for l in lines]
        r["decisions"] = [d["decision"] for d in decisions if d]
        r["potential_savings"] = sum(d["payload"]["savings_inr"] for d in decisions if d)
        r["potential_co2"] = round(sum(d["payload"]["co2_saved_kg"] for d in decisions if d), 1)
    return ros


@app.get("/api/ros/{ro_id}")
def get_ro(ro_id: str):
    return ro_detail(ro_id)


class NewLine(BaseModel):
    part_id: str
    labor_desc: str = ""


class NewVehicle(BaseModel):
    customer_name: str = Field(min_length=1)
    phone: str = Field(min_length=5)
    make_model: str = Field(min_length=1)
    body: str = "hatchback"
    year: int = Field(ge=1990, le=2027)
    km: int = Field(ge=0)
    factory_warranty_until: str | None = None  # blank = unknown, assume 3 years from model year
    ext_warranty_active: bool = False
    ext_warranty_categories: list[str] = []
    ext_warranty_until: str | None = None

    @field_validator("factory_warranty_until", "ext_warranty_until")
    @classmethod
    def _iso_date(cls, v):
        if v in (None, ""):
            return None
        try:
            date.fromisoformat(v)
        except ValueError:
            raise ValueError("use a YYYY-MM-DD date")
        return v

    @field_validator("customer_name", "make_model", "phone")
    @classmethod
    def _strip(cls, v: str):
        v = v.strip()
        if not v:
            raise ValueError("required")
        return v


def _insert_vehicle(c, nv: NewVehicle) -> tuple[str, str]:
    cid = "C" + secrets.token_hex(3)
    vid = "V" + secrets.token_hex(3)
    # Unknown factory warranty: assume the common 3-year term from the model year.
    fw = nv.factory_warranty_until or f"{nv.year + 3}-06-30"
    ext_until = nv.ext_warranty_until if nv.ext_warranty_active else None
    c.execute("INSERT INTO customers VALUES (?,?,?,?)", (cid, nv.customer_name, nv.phone, 0))
    c.execute("INSERT INTO vehicles VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              (vid, cid, nv.make_model, nv.body, nv.year, nv.km, "—", fw,
               int(nv.ext_warranty_active and bool(ext_until)), json.dumps(nv.ext_warranty_categories), ext_until))
    return cid, vid


def _next_ro_id() -> str:
    last = db.row("SELECT id FROM repair_orders ORDER BY CAST(SUBSTR(id,4) AS INTEGER) DESC LIMIT 1")
    return f"RO-{int(last['id'][3:]) + 1 if last else 24817}"


class NewRO(BaseModel):
    vehicle_id: str | None = None
    new_vehicle: NewVehicle | None = None
    complaint: str = ""
    advisor: str = "Sneha K."
    lines: list[NewLine] = Field(min_length=1)
    analyze: bool = True


@app.post("/api/ros")
def create_ro(body: NewRO):
    if not body.vehicle_id and not body.new_vehicle:
        raise HTTPException(422, "Pick an existing vehicle or describe a new one")
    for l in body.lines:
        if not db.row("SELECT 1 AS x FROM parts WHERE id=?", (l.part_id,)):
            raise HTTPException(422, f"Unknown part {l.part_id}")
    ro_id = _next_ro_id()
    with db.tx() as c:
        vid = body.vehicle_id
        if body.new_vehicle:
            _, vid = _insert_vehicle(c, body.new_vehicle)
        elif not db.row("SELECT 1 AS x FROM vehicles WHERE id=?", (vid,)):
            raise HTTPException(422, "Unknown vehicle")
        c.execute("INSERT INTO repair_orders (id, rooftop_id, vehicle_id, advisor, status, complaint, created_at) VALUES (?,?,?,?,?,?,?)",
                  (ro_id, home_rooftop()["id"], vid, body.advisor, "open", body.complaint, db.now()))
        for l in body.lines:
            c.execute("INSERT INTO ro_lines (ro_id, part_id, labor_desc) VALUES (?,?,?)", (ro_id, l.part_id, l.labor_desc))
        db.audit(c, ro_id, "Tekion ARC", "RO_CREATED", {"lines": [l.part_id for l in body.lines]})
    return analyze_ro(ro_id) if body.analyze else ro_detail(ro_id)


class DiagnoseBody(BaseModel):
    complaint: str
    make_model: str = ""
    year: int | None = None
    km: int | None = None


@app.post("/api/diagnose")
def diagnose_endpoint(body: DiagnoseBody):
    """Free-text symptoms -> suggested catalog parts (LLM, or keyword fallback)."""
    return diagnose.diagnose(body.complaint, body.model_dump(), catalog())


class IntakeBody(BaseModel):
    vehicle: NewVehicle
    complaint: str = Field(min_length=5, max_length=2000)


@app.post("/api/intake")
def intake(body: IntakeBody):
    """Customer self-service booking: their details + their own description of the problem."""
    dx = diagnose.diagnose(body.complaint, body.vehicle.model_dump(), catalog())
    ro_id = _next_ro_id()
    token = secrets.token_urlsafe(6)
    with db.tx() as c:
        _, vid = _insert_vehicle(c, body.vehicle)
        c.execute("INSERT INTO repair_orders (id, rooftop_id, vehicle_id, advisor, status, complaint, created_at, customer_token, source, diagnosis) VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (ro_id, home_rooftop()["id"], vid, "Unassigned", "open", body.complaint.strip(), db.now(), token,
                   "customer", json.dumps(dx, ensure_ascii=False)))
        for p in dx["parts"]:
            c.execute("INSERT INTO ro_lines (ro_id, part_id, labor_desc) VALUES (?,?,?)",
                      (ro_id, p["part_id"], f"Suspected from customer description: {p['reason']}"[:200]))
        db.audit(c, ro_id, "Customer", "ONLINE_BOOKING", {"complaint_chars": len(body.complaint)})
        db.audit(c, ro_id, "AI intake", "SYMPTOMS_MAPPED", {"mode": dx["mode"], "parts": [p["part_id"] for p in dx["parts"]], "llm_input_has_pii": False})
    return {"ro_id": ro_id, "token": token, "diagnosis": dx}


class NewPart(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    category: str
    new_price: int = Field(gt=0, le=5_000_000)
    labor_hours: float = Field(default=1.0, ge=0, le=40)


CATEGORIES = ["electrical", "hvac", "engine", "transmission", "body", "brakes", "steering", "airbags", "suspension", "tyres", "seatbelts"]


@app.post("/api/parts")
def add_part(body: NewPart):
    """Add a part that isn't in the catalog yet (e.g. from a real customer job)."""
    if body.category not in CATEGORIES:
        raise HTTPException(422, f"category must be one of {', '.join(CATEGORIES)}")
    rules = current_rules()
    pid = "CUS-" + secrets.token_hex(2).upper()
    # Embodied-CO2 estimate from price when no LCA figure exists (~1.6 kg per 1,000 rupees, calibrated on the catalog).
    co2 = round(max(0.5, body.new_price * 0.0016), 1)
    safety = int(body.category in rules.safety.new_only_categories)
    with db.tx() as c:
        c.execute("INSERT INTO parts VALUES (?,?,?,?,?,?,?)", (pid, body.name.strip(), body.category, safety, body.new_price, co2, body.labor_hours))
        db.audit(c, None, "Advisor", "PART_ADDED", {"id": pid, "name": body.name, "category": body.category, "co2_estimate_kg": co2})
    return db.row("SELECT * FROM parts WHERE id=?", (pid,))


def _editable(ro_id: str) -> dict:
    ro = db.row("SELECT * FROM repair_orders WHERE id=?", (ro_id,))
    if not ro:
        raise HTTPException(404, "Repair order not found")
    if ro["status"] in ("awaiting_customer", "customer_approved", "closed"):
        raise HTTPException(409, "Lines are locked once the estimate is sent to the customer")
    return ro


class LineBody(BaseModel):
    part_id: str
    labor_desc: str = ""


@app.post("/api/ros/{ro_id}/lines")
def add_line(ro_id: str, body: LineBody):
    _editable(ro_id)
    part = db.row("SELECT * FROM parts WHERE id=?", (body.part_id,))
    if not part:
        raise HTTPException(422, "Unknown part")
    with db.tx() as c:
        c.execute("INSERT INTO ro_lines (ro_id, part_id, labor_desc) VALUES (?,?,?)",
                  (ro_id, body.part_id, body.labor_desc or f"Replace {part['name'].lower()}"))
        c.execute("UPDATE repair_orders SET status='open' WHERE id=?", (ro_id,))
        db.audit(c, ro_id, "Advisor", "LINE_ADDED", {"part": part["name"]})
    return ro_detail(ro_id)


@app.delete("/api/ros/{ro_id}/lines/{line_id}")
def delete_line(ro_id: str, line_id: int):
    _editable(ro_id)
    line = db.row("SELECT l.*, p.name FROM ro_lines l JOIN parts p ON p.id=l.part_id WHERE l.id=? AND l.ro_id=?", (line_id, ro_id))
    if not line:
        raise HTTPException(404, "Line not found")
    with db.tx() as c:
        c.execute("DELETE FROM recommendations WHERE ro_line_id=?", (line_id,))
        c.execute("DELETE FROM ro_lines WHERE id=?", (line_id,))
        c.execute("UPDATE repair_orders SET status='open' WHERE id=?", (ro_id,))
        db.audit(c, ro_id, "Advisor", "LINE_REMOVED", {"part": line["name"]})
    return ro_detail(ro_id)


@app.post("/api/ros/{ro_id}/analyze")
def analyze(ro_id: str):
    return analyze_ro(ro_id)


class Approval(BaseModel):
    line_id: int
    option_id: str
    override_reason: str | None = None


class ApproveBody(BaseModel):
    approvals: list[Approval]
    advisor: str = "Sneha K."


@app.post("/api/ros/{ro_id}/approve")
def approve(ro_id: str, body: ApproveBody, request: Request):
    ro = ro_detail(ro_id)
    if ro["status"] not in ("recommended", "awaiting_customer"):
        raise HTTPException(409, f"Cannot approve a repair order in status '{ro['status']}'")
    by_line = {l["id"]: l for l in ro["lines"]}
    if {a.line_id for a in body.approvals} != set(by_line):
        raise HTTPException(422, "Approve every line on the repair order")
    token = ro["customer_token"] or secrets.token_urlsafe(6)
    with db.tx() as c:
        for a in body.approvals:
            rec = by_line[a.line_id]["recommendation"]
            if not rec:
                raise HTTPException(422, "Run PartWise before approving")
            opt = engine.option_by_id(rec["payload"], a.option_id)
            if not opt:
                raise HTTPException(422, f"Unknown option {a.option_id}")
            if rec["decision"] in ("NEW_ONLY", "WARRANTY") and a.option_id != rec["payload"]["recommended_id"]:
                raise HTTPException(422, f"{by_line[a.line_id]['part_name']}: policy does not allow an override here")
            if opt.get("exclusions"):
                raise HTTPException(422, f"Option excluded by rules: {', '.join(opt['exclusions'])}")
            overridden = a.option_id != rec["payload"]["recommended_id"]
            if overridden and not (a.override_reason or "").strip():
                raise HTTPException(422, "An override needs a reason (it is written to the audit log)")
            c.execute("UPDATE ro_lines SET approved_option=?, override_reason=?, status='approved' WHERE id=?",
                      (a.option_id, a.override_reason if overridden else None, a.line_id))
            db.audit(c, ro_id, body.advisor, "ADVISOR_OVERRIDE" if overridden else "ADVISOR_APPROVED",
                     {"line": a.line_id, "part": by_line[a.line_id]["part_name"], "option": a.option_id,
                      "recommended": rec["payload"]["recommended_id"], "reason": a.override_reason if overridden else None})
        link = str(request.base_url).rstrip("/") + f"/c/{token}"
        name = ro["customer"]["name"].split()[0]
        sms_body = (f"Apex Motors: Hi {name}, your {ro['vehicle']['make_model']} estimate ({ro_id}) is ready. "
                    f"Compare part options, see your savings & CO2 impact, and choose here: {link}")
        status = send_sms(ro["customer"]["phone"], sms_body)
        c.execute("INSERT INTO sms_outbox (ro_id, to_phone, body, link, status, created_at) VALUES (?,?,?,?,?,?)",
                  (ro_id, ro["customer"]["phone"], sms_body, f"/c/{token}", status, db.now()))
        c.execute("UPDATE repair_orders SET status='awaiting_customer', customer_token=?, approved_at=? WHERE id=?",
                  (token, db.now(), ro_id))
        db.audit(c, ro_id, "Twilio", "SMS_SENT", {"to": "masked", "status": status})
    return ro_detail(ro_id)


# ---------------------------------------------------------------- customer app
def _customer_view(ro: dict) -> dict:
    rules = current_rules()
    if ro["status"] in ("open", "recommended"):
        dx = ro.get("diagnosis") or {}
        return {
            "ro_id": ro["id"], "status": "reviewing", "dealer": ro["rooftop"]["name"],
            "vehicle": f"{ro['vehicle']['year']} {ro['vehicle']['make_model']}",
            "customer_first_name": ro["customer"]["name"].split()[0], "green_points": ro["customer"]["green_points"],
            "reward_threshold": rules.green_points.reward_threshold, "reward_name": rules.green_points.reward_name,
            "complaint": ro["complaint"], "summary": dx.get("summary"),
            "suspected": [l["part_name"] for l in ro["lines"]],
            "rooftops": len(db.rows("SELECT id FROM rooftops")),
            "lines": [], "ledger": [],
        }
    out_lines = []
    for l in ro["lines"]:
        rec = l["recommendation"]
        p = rec["payload"]
        approved = engine.option_by_id(p, l["approved_option"] or p["recommended_id"])
        best_new = engine.option_by_id(p, p["best_new_id"])
        choices = [approved] if approved["id"] == best_new["id"] else [approved, best_new]
        if rec["decision"] == "NEW_RECOMMENDED":
            alt = max((o for o in p["options"] if o["eligible"] and o["condition"] != "new"),
                      key=lambda o: o["score"] or 0, default=None)
            if alt:
                choices.append(alt)
        fixed = rec["decision"] in ("NEW_ONLY", "WARRANTY")
        out_lines.append({
            "line_id": l["id"], "part": l["part_name"], "decision": rec["decision"], "fixed": fixed,
            "recommended_id": approved["id"], "chosen_id": l["chosen_option"],
            "message": rec["explanation"]["customer_message"],
            "options": [{
                "id": o["id"], "kind": o["kind"], "grade": o["grade"], "price": o["price"],
                "wait_days": o["wait_days"], "warranty_months": o["warranty_months"],
                "co2_kg": o["co2_kg"], "from": o["rooftop"], "distance_km": o["distance_km"],
                **engine.impact_of(p, o["id"], rules),
            } for o in choices],
        })
    cust = ro["customer"]
    return {
        "ro_id": ro["id"], "status": ro["status"], "dealer": ro["rooftop"]["name"],
        "vehicle": f"{ro['vehicle']['year']} {ro['vehicle']['make_model']}",
        "customer_first_name": cust["name"].split()[0], "green_points": cust["green_points"],
        "reward_threshold": rules.green_points.reward_threshold, "reward_name": rules.green_points.reward_name,
        "lines": out_lines,
        "ledger": db.rows("SELECT points, co2_kg, note, created_at FROM green_ledger WHERE customer_id=? ORDER BY id DESC", (cust["id"],)),
    }


def _ro_by_token(token: str) -> dict:
    r = db.row("SELECT id FROM repair_orders WHERE customer_token=?", (token,))
    if not r:
        raise HTTPException(404, "This link has expired or is invalid")
    return ro_detail(r["id"])


@app.get("/api/customer/{token}")
def customer_view(token: str):
    return _customer_view(_ro_by_token(token))


class ChooseBody(BaseModel):
    choices: dict[int, str]


@app.post("/api/customer/{token}/choose")
def customer_choose(token: str, body: ChooseBody):
    ro = _ro_by_token(token)
    if ro["status"] != "awaiting_customer":
        raise HTTPException(409, "You have already confirmed this estimate")
    rules = current_rules()
    view = {l["line_id"]: l for l in _customer_view(ro)["lines"]}
    by_line = {l["id"]: l for l in ro["lines"]}
    total_points, total_co2 = 0, 0.0
    with db.tx() as c:
        for line_id, vl in view.items():
            option_id = vl["recommended_id"] if vl["fixed"] else body.choices.get(line_id, vl["recommended_id"])
            if option_id not in {o["id"] for o in vl["options"]}:
                raise HTTPException(422, "Invalid option")
            line = by_line[line_id]
            p = line["recommendation"]["payload"]
            opt = engine.option_by_id(p, option_id)
            imp = engine.impact_of(p, option_id, rules)
            c.execute("UPDATE ro_lines SET chosen_option=?, status='customer_approved' WHERE id=?", (option_id, line_id))
            fee = 0
            idle_value = 0
            if opt.get("inventory_id"):
                inv = c.execute("SELECT * FROM inventory WHERE id=?", (opt["inventory_id"],)).fetchone()
                if inv is None or inv["qty"] < 1:
                    raise HTTPException(409, f"{line['part_name']}: that part was just sold to another order. Please refresh.")
                c.execute("UPDATE inventory SET qty=qty-1 WHERE id=?", (opt["inventory_id"],))
                if opt["rooftop_id"] != ro["rooftop_id"]:
                    fee = rules.logistics.transfer_fee_inr
                    c.execute("INSERT INTO transfers (ro_id, line_id, inventory_id, part_id, from_rooftop, to_rooftop, status, fee, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                              (ro["id"], line_id, opt["inventory_id"], line["part_id"], opt["rooftop_id"], ro["rooftop_id"],
                               "requested", fee, db.now()))
                    db.audit(c, ro["id"], "PartWise → ARC", "TRANSFER_REQUESTED",
                             {"part": line["part_name"], "from": opt["rooftop"], "to": ro["rooftop"]["short"], "fee": fee})
                if inv["days_in_stock"] > 365:
                    idle_value = opt["price"]
            elif opt["id"].startswith("oem-"):
                db.audit(c, ro["id"], "PartWise → ARC", "OEM_ORDER_PLACED", {"part": line["part_name"]})
            c.execute("INSERT INTO outcomes (ro_id, line_id, rooftop_id, part_id, category, decision, chosen_condition, had_alternative, savings_inr, co2_saved_kg, wait_days_saved, idle_value_moved, transfer_fee, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (ro["id"], line_id, ro["rooftop_id"], line["part_id"], line["category"], line["recommendation"]["decision"],
                       opt["condition"], int(any(o["eligible"] and o["condition"] != "new" for o in p["options"])),
                       imp["savings_inr"], imp["co2_saved_kg"], imp["wait_days_saved"], idle_value, fee, db.now()))
            db.audit(c, ro["id"], "Customer", "CUSTOMER_CHOSE",
                     {"part": line["part_name"], "option": option_id, "type": opt["kind"], "savings_inr": imp["savings_inr"], "co2_saved_kg": imp["co2_saved_kg"]})
            db.audit(c, ro["id"], "PartWise → ARC", "ARC_WRITEBACK",
                     {"endpoint": f"PATCH /arc/v1/repair-orders/{ro['id']}/lines/{line_id}", "part_source": opt["kind"], "price": opt["price"]})
            total_points += imp["green_points"]
            total_co2 += imp["co2_saved_kg"]
        if total_points:
            c.execute("UPDATE customers SET green_points=green_points+? WHERE id=?", (total_points, ro["customer"]["id"]))
            c.execute("INSERT INTO green_ledger (customer_id, ro_id, points, co2_kg, note, created_at) VALUES (?,?,?,?,?,?)",
                      (ro["customer"]["id"], ro["id"], total_points, round(total_co2, 1), "Greener part choice", db.now()))
            db.audit(c, ro["id"], "Green Points ledger", "POINTS_AWARDED", {"points": total_points, "co2_kg": round(total_co2, 1)})
        c.execute("UPDATE repair_orders SET status='customer_approved', customer_decided_at=? WHERE id=?", (db.now(), ro["id"]))
    return {"points_awarded": total_points, "co2_saved_kg": round(total_co2, 1), "view": _customer_view(ro_detail(ro["id"]))}


# ---------------------------------------------------------------- catalog / network
@app.get("/api/catalog")
def catalog():
    return db.rows("SELECT * FROM parts ORDER BY name")


@app.get("/api/vehicles")
def vehicles():
    vs = db.rows("SELECT v.*, c.name AS customer_name FROM vehicles v JOIN customers c ON c.id=v.customer_id ORDER BY c.name")
    for v in vs:
        v["ext_warranty_categories"] = json.loads(v["ext_warranty_categories"] or "[]")
    return vs


@app.get("/api/network")
def network():
    home = home_rooftop()
    roofs = db.rows("SELECT * FROM rooftops")
    inv = db.rows("SELECT i.*, p.name AS part_name, p.category, p.new_price FROM inventory i JOIN parts p ON p.id=i.part_id WHERE qty>0")
    out = []
    for r in roofs:
        mine = [i for i in inv if i["rooftop_id"] == r["id"]]
        idle = [i for i in mine if i["days_in_stock"] > 365]
        out.append({
            **r, "distance_km": 0 if r["id"] == home["id"] else engine.road_km(home, r),
            "units": sum(i["qty"] for i in mine),
            "units_by_condition": {k: sum(i["qty"] for i in mine if i["condition"] == k) for k in ("new", "remanufactured", "recycled")},
            "stock_value": sum(i["qty"] * i["price"] for i in mine),
            "idle_value": sum(i["qty"] * i["price"] for i in idle),
            "idle_items": sorted(idle, key=lambda i: -i["qty"] * i["price"])[:5],
        })
    transfers = db.rows("SELECT t.*, p.name AS part_name FROM transfers t JOIN parts p ON p.id=t.part_id ORDER BY t.id DESC")
    return {"home": home, "rooftops": out, "inventory": inv, "transfers": transfers,
            "max_transfer_km": current_rules().recycled.max_transfer_km}


# ---------------------------------------------------------------- dashboard
@app.get("/api/dashboard")
def dashboard(days: int = 90):
    since = (datetime.now() - timedelta(days=days)).isoformat()
    rows = db.rows("SELECT * FROM outcomes WHERE created_at>=? ORDER BY created_at", (since,))
    green = [r for r in rows if r["chosen_condition"] != "new"]
    with_alt = [r for r in rows if r["had_alternative"]]
    weekly: dict[str, dict] = defaultdict(lambda: {"co2": 0.0, "savings": 0, "lines": 0, "green": 0, "days": set()})
    for r in rows:
        d = datetime.fromisoformat(r["created_at"])
        wk = (d - timedelta(days=d.weekday())).date().isoformat()
        w = weekly[wk]
        w["co2"] += r["co2_saved_kg"]
        w["savings"] += r["savings_inr"]
        w["lines"] += 1
        w["green"] += r["chosen_condition"] != "new"
        w["days"].add(d.date())
    roofs = {r["id"]: r["short"] for r in db.rows("SELECT * FROM rooftops")}
    by_roof = defaultdict(lambda: {"co2": 0.0, "savings": 0, "alt": 0, "green": 0})
    by_cat = defaultdict(lambda: {"co2": 0.0, "count": 0})
    mix = defaultdict(int)
    for r in rows:
        b = by_roof[roofs.get(r["rooftop_id"], r["rooftop_id"])]
        b["co2"] += r["co2_saved_kg"]
        b["savings"] += r["savings_inr"]
        b["alt"] += r["had_alternative"]
        b["green"] += r["chosen_condition"] != "new"
        if r["chosen_condition"] != "new":
            by_cat[r["category"]]["co2"] += r["co2_saved_kg"]
            by_cat[r["category"]]["count"] += 1
        mix[r["decision"]] += 1
    n_roofs = len(roofs)
    transfer_fees = sum(r["transfer_fee"] for r in rows)
    months = max(days / 30, 1)
    return {
        "days": days,
        "kpis": {
            "lines_analyzed": len(rows),
            "co2_saved_kg": round(sum(r["co2_saved_kg"] for r in rows), 1),
            "customer_savings_inr": sum(r["savings_inr"] for r in rows),
            "recycled_uptake": round(len(green) / len(with_alt), 3) if with_alt else 0,
            "wait_days_avoided": sum(r["wait_days_saved"] for r in rows),
            "idle_value_moved": sum(r["idle_value_moved"] for r in rows),
            "savings_per_ro_line": round(sum(r["savings_inr"] for r in green) / len(green)) if green else 0,
            "green_parts_fitted": len(green),
        },
        "weekly": [{"week": k, "co2": round(v["co2"], 1), "co2_per_day": round(v["co2"] / len(v["days"]), 1), "savings": v["savings"], "lines": v["lines"],
                    "uptake": round(v["green"] / v["lines"], 3) if v["lines"] else 0} for k, v in sorted(weekly.items())],
        "by_rooftop": [{"rooftop": k, "co2": round(v["co2"], 1), "savings": v["savings"],
                        "uptake": round(v["green"] / v["alt"], 3) if v["alt"] else 0} for k, v in by_roof.items()],
        "by_category": sorted([{"category": k, "co2": round(v["co2"], 1), "count": v["count"]} for k, v in by_cat.items()], key=lambda x: -x["co2"]),
        "decision_mix": [{"decision": k, "count": v} for k, v in mix.items()],
        "tekion_revenue": {
            "subscription_inr": int(SUBSCRIPTION_PER_ROOFTOP_INR * n_roofs * months),
            "transfer_fees_inr": transfer_fees,
            "rooftops": n_roofs,
            "per_rooftop_month": SUBSCRIPTION_PER_ROOFTOP_INR,
        },
        "recent": db.rows("SELECT o.*, p.name AS part_name FROM outcomes o JOIN parts p ON p.id=o.part_id WHERE line_id IS NOT NULL ORDER BY o.id DESC LIMIT 10"),
    }


# ---------------------------------------------------------------- rules
@app.get("/api/rules")
def get_rules():
    r = db.row("SELECT * FROM rules_versions ORDER BY version DESC LIMIT 1")
    return {**r, "parsed": parse_rules(r["yaml"]).model_dump(),
            "history": db.rows("SELECT version, created_at, author, note FROM rules_versions ORDER BY version DESC")}


class RulesBody(BaseModel):
    yaml: str
    author: str = "Dealer admin"
    note: str = ""


@app.put("/api/rules")
def put_rules(body: RulesBody):
    try:
        parsed = parse_rules(body.yaml)
    except ValidationError as e:
        raise HTTPException(422, "; ".join(f"{'.'.join(map(str, er['loc']))}: {er['msg']}" for er in e.errors()))
    except Exception as e:
        raise HTTPException(422, f"Invalid YAML: {e}")
    last = db.row("SELECT MAX(version) AS v FROM rules_versions")["v"]
    version = last + 1
    text = set_version(body.yaml, version)
    with db.tx() as c:
        c.execute("INSERT INTO rules_versions VALUES (?,?,?,?,?)", (version, text, db.now(), body.author, body.note or parsed.note))
        db.audit(c, None, body.author, "RULES_PUBLISHED", {"version": version, "note": body.note})
    return get_rules()


class PreviewBody(BaseModel):
    ro_id: str
    weights: Weights


@app.post("/api/rules/preview")
def preview(body: PreviewBody):
    """What-if: re-score a repair order with different weights, without saving anything."""
    rules = current_rules()
    ro = db.row("SELECT * FROM repair_orders WHERE id=?", (body.ro_id,))
    if not ro:
        raise HTTPException(404, "Repair order not found")
    vehicle = get_vehicle(ro["vehicle_id"])
    rooftops = db.rows("SELECT * FROM rooftops")
    home = db.row("SELECT * FROM rooftops WHERE id=?", (ro["rooftop_id"],))
    out = []
    for l in db.rows("SELECT * FROM ro_lines WHERE ro_id=?", (body.ro_id,)):
        part = db.row("SELECT * FROM parts WHERE id=?", (l["part_id"],))
        base = engine.analyze_line(part, vehicle, home, rooftops, rules)
        what = engine.analyze_line(part, vehicle, home, rooftops, rules, weights_override=body.weights.normalized())
        out.append({"part": part["name"], "current": _brief(base), "what_if": _brief(what)})
    return out


def _brief(p: dict) -> dict:
    rec = engine.option_by_id(p, p["recommended_id"])
    return {"decision": p["decision"], "option": f"{rec['kind']} · {rec['rooftop']}", "price": rec["price"],
            "savings": p["savings_inr"], "co2_saved": p["co2_saved_kg"],
            "scores": [{"label": f"{o['kind']} · {o['rooftop']}", "score": o["score"]} for o in p["options"] if o["score"] is not None]}


# ---------------------------------------------------------------- audit / sms
@app.get("/api/audit")
def audit_log(ro_id: str | None = None, limit: int = 300):
    if ro_id:
        rs = db.rows("SELECT * FROM audit_log WHERE ro_id=? ORDER BY id DESC LIMIT ?", (ro_id, limit))
    else:
        rs = db.rows("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,))
    for r in rs:
        r["detail"] = json.loads(r["detail"])
    return rs


@app.get("/api/sms")
def sms():
    return db.rows("SELECT * FROM sms_outbox ORDER BY id DESC")


# ---------------------------------------------------------------- static frontend
DIST = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(os.path.join(DIST, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    f = os.path.join(DIST, path)
    if path and os.path.isfile(f):
        return FileResponse(f)
    index = os.path.join(DIST, "index.html")
    if os.path.isfile(index):
        return FileResponse(index)
    return {"message": "PartWise API is running. Build the frontend (npm run build) or use the Vite dev server on :5173."}
