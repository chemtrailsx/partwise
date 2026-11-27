"""AI explainer: turns a finished decision into plain-language reasons.

* Input is decision data only — no customer name, phone, VIN or any personal data.
* Output is a JSON object (free-tier OpenAI-compatible provider, see llm.py).
* A grounding guard rejects any ₹ amount the facts don't contain and falls back
  to a deterministic template. Without an API key the template is used directly.
"""
from __future__ import annotations

import hashlib
import json
import re

from . import db, llm

SCHEMA = {
    "type": "object",
    "properties": {
        "advisor_reason": {"type": "string", "description": "One or two sentences for the service advisor, max 45 words."},
        "customer_message": {"type": "string", "description": "One or two friendly sentences for the car owner, max 35 words, no jargon or rule IDs."},
        "key_factors": {"type": "array", "items": {"type": "string"}, "description": "2-4 short factor tags, e.g. 'saves ₹3,500'."},
    },
    "required": ["advisor_reason", "customer_message", "key_factors"],
    "additionalProperties": False,
}

SYSTEM = (
    "You explain automotive repair part recommendations made by PartWise, a decision engine "
    "inside a dealership management system. The decision has already been made by rules and "
    "scoring; never change it, second-guess it or add options. Use ONLY the facts given: do not "
    "invent prices, distances, warranty terms or CO2 numbers. Write rupee amounts like ₹3,500. "
    "Safety-critical parts are always new; say so plainly. Use the exact part type given "
    "(remanufactured, recycled, new or warranty); never call a remanufactured part recycled. "
    "Do not mention internal scores, rule IDs or JSON field names in customer_message. "
    "Keep it short and concrete."
)


def _inr(n: float) -> str:
    n = int(round(n))
    s = str(abs(n))
    if len(s) > 3:  # Indian digit grouping
        head, tail = s[:-3], s[-3:]
        head = re.sub(r"(\d)(?=(\d\d)+$)", r"\1,", head)
        s = head + "," + tail
    return ("-₹" if n < 0 else "₹") + s


def _lc(name: str) -> str:
    """Lower-case a part name for mid-sentence use, keeping acronyms (AC, ECU)."""
    return " ".join(w if w.isupper() else w.lower() for w in name.split())


def build_facts(payload: dict) -> dict:
    """The exact, PII-free JSON the LLM sees. Shown in the UI for transparency."""
    opts = {o["id"]: o for o in payload["options"]}
    pick = opts[payload["recommended_id"]]
    new = opts[payload["best_new_id"]]

    def brief(o):
        return {
            "type": o["kind"], "grade": o["grade"], "from": o["rooftop"],
            "distance_km": round(o["distance_km"]), "customer_price": _inr(o["price"]),
            "ready": "today" if o["wait_days"] == 0 else "tomorrow" if o["wait_days"] == 1 else f"in {o['wait_days']} days",
            "wait_days": o["wait_days"],
            "co2_kg": round(o["co2_kg"], 1), "part_warranty_months": o["warranty_months"],
        }

    excluded = [{"from": o["rooftop"], "type": o["kind"], "why_excluded": o["exclusions"]}
                for o in payload["options"] if o.get("exclusions")][:4]
    v = payload["vehicle"]
    return {
        "part": payload["part"]["name"],
        "part_category": payload["part"]["category"],
        "decision": payload["decision"],
        "rules_fired": [h["rule"] + ": " + h["text"] for h in payload["rule_hits"]],
        "vehicle": {"age_years": round(v["age_years"]), "odometer_km": v["km"],
                    "factory_warranty_active": v["factory_warranty_active"],
                    "extended_warranty_active": v["ext_warranty_active"]},
        "recommended": brief(pick),
        "new_part_alternative": None if pick["id"] == new["id"] else brief(new),
        "savings_vs_new": _inr(payload["savings_inr"]),
        "co2_saved_kg": payload["co2_saved_kg"],
        "excluded_options": excluded,
    }


def template(facts: dict) -> dict:
    d, part, rec = facts["decision"], facts["part"], facts["recommended"]
    if d == "NEW_ONLY":
        n = len(facts["excluded_options"])
        blocked = f" {n} recycled option{'s' if n != 1 else ''} in the network {'were' if n != 1 else 'was'} blocked." if n else ""
        return {
            "advisor_reason": f"{part} is safety-critical, so only a new part is allowed (SAFETY-01).{blocked}",
            "customer_message": "This is a safety part, so we always fit a brand-new one.",
            "key_factors": ["safety-critical", "new only"],
        }
    if d == "WARRANTY":
        which = "extended" if facts["vehicle"]["extended_warranty_active"] and not facts["vehicle"]["factory_warranty_active"] else "factory"
        return {
            "advisor_reason": f"Covered by the active {which} warranty: warranty-approved part, ₹0 to the customer; claim goes to the OEM.",
            "customer_message": f"Good news: your {which} warranty covers the {_lc(part)}, so you pay nothing for this part.",
            "key_factors": [f"{which} warranty", "₹0 to customer"],
        }
    if d == "RECYCLED_RECOMMENDED":
        new = facts["new_part_alternative"] or {}
        grade = f"grade-{rec['grade']} " if rec["grade"] else ""
        faster = ""
        if new and rec["wait_days"] < new["wait_days"]:
            faster = f", ready {rec['ready']} instead of {new['ready']}"
        elif new and rec["wait_days"] > new["wait_days"]:
            faster = f" (ready {rec['ready']}; new would be ready {new['ready']})"
        return {
            "advisor_reason": (f"Not covered by warranty and not a safety part. A {grade}{rec['type']} {_lc(part)} from "
                               f"{rec['from']} ({rec['distance_km']} km) saves {facts['savings_vs_new']}{faster}, "
                               f"has a {rec['part_warranty_months']}-month warranty and avoids ≈{facts['co2_saved_kg']:g} kg CO₂."),
            "customer_message": (f"Not covered by your warranty and not a safety part: a tested {rec['type']} {_lc(part)} "
                                 f"is {facts['savings_vs_new']} cheaper and ready {rec['ready']}."),
            "key_factors": [f"saves {facts['savings_vs_new']}", f"≈{facts['co2_saved_kg']:g} kg CO₂ saved",
                            f"ready {rec['ready']}", f"{rec['part_warranty_months']}-month warranty"],
        }
    # NEW_RECOMMENDED
    ex = facts["excluded_options"]
    if any("STOCK-01" in r for r in facts["rules_fired"]):
        why = ("no recycled part passed the checks (" + "; ".join(ex[0]["why_excluded"]) + ")") if ex else "no recycled or remanufactured part is in stock across the network"
    else:
        why = "the eligible recycled options scored lower on price, wait and warranty combined"
    return {
        "advisor_reason": f"New part recommended: {why}.",
        "customer_message": f"We recommend a new {_lc(part)}, ready {rec['ready']}, with a {rec['part_warranty_months']}-month warranty.",
        "key_factors": ["new part", f"ready {rec['ready']}"],
    }


def _amounts(text: str) -> set[int]:
    """Rupee figures as integers, so '₹4,500,' / '₹ 4500' / '₹4,500.' all compare equal."""
    return {int(m.replace(",", "")) for m in re.findall(r"₹\s?(\d+(?:,\d+)*)", text)}


def _grounded(out: dict, facts: dict) -> bool:
    allowed = _amounts(json.dumps(facts, ensure_ascii=False)) | {0}
    produced = _amounts(" ".join([out["advisor_reason"], out["customer_message"], *out["key_factors"]]))
    return produced <= allowed


def llm_available() -> bool:
    return llm.available()


def explain(payload: dict) -> tuple[dict, str, dict]:
    """Returns (explanation, mode, facts). mode: 'llm:<provider>' | 'cache' | 'template' | 'template:<why>'."""
    facts = build_facts(payload)
    cfg = llm.config()
    if not cfg:
        return template(facts), "template", facts

    key = hashlib.sha256((cfg["provider"] + cfg["model"] + json.dumps(facts, sort_keys=True, ensure_ascii=False)).encode()).hexdigest()
    cached = db.row("SELECT value FROM llm_cache WHERE key=?", (key,))
    if cached:
        return json.loads(cached["value"]), "cache", facts

    try:
        out = llm.chat_json(SYSTEM, "Explain this decision.\n\n" + json.dumps(facts, ensure_ascii=False, indent=1), SCHEMA)
        if not (isinstance(out.get("advisor_reason"), str) and isinstance(out.get("customer_message"), str)):
            return template(facts), "template:bad-shape", facts
        out["key_factors"] = [str(x) for x in (out.get("key_factors") or [])][:4]
        if not _grounded(out, facts):
            return template(facts), "template:grounding-guard", facts
        with db.tx() as c:
            c.execute("INSERT OR REPLACE INTO llm_cache VALUES (?,?)", (key, json.dumps(out, ensure_ascii=False)))
        return out, f"llm:{cfg['provider']}", facts
    except Exception as e:  # network, auth, bad JSON: never block the advisor
        return template(facts), f"template:{type(e).__name__}", facts
