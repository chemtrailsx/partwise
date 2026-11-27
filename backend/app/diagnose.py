"""Customer's own words -> suggested part lines.

The LLM sees only the complaint text, the car (model, year, km) and the parts catalog;
never the customer's name or phone. Every suggestion is checked against the catalog.
Without an LLM key a keyword matcher does the same job, so intake always works.
The service advisor reviews and edits the suggested lines before anything is quoted.
"""
from __future__ import annotations

import re

from . import llm

KEYWORDS: list[tuple[str, str]] = [
    # (regex over the lower-cased complaint, part id)
    (r"battery (warning )?light|charging|alternator|battery (keeps )?(dying|drain|dead)|dim(ming)? lights", "ALT-2290"),
    (r"(won'?t|doesn'?t|does not|didn'?t|did not|not|never|struggles? to) (easily )?(start|crank)|not starting|hard to start|start(ing)? (problem|trouble|issue)|starter|click(s|ing)?|crank", "STM-1180"),
    (r"\bac\b|a/c|air ?con|not cooling|cooling (is )?(weak|poor)|warm air", "ACC-5510"),
    (r"overheat|temperature (gauge )?(high|rising)|coolant (leak)?|radiator", "RAD-7020"),
    (r"overheat|coolant leak|water pump|whining from (the )?engine", "WPM-3310"),
    (r"turbo|low power|loss of power|lacks? power|black smoke|whistl", "TRB-9900"),
    (r"misfir|injector|rough idle|fuel (smell|consumption)|poor mileage", "INJ-4410"),
    (r"gear(s)? slip|gearbox|transmission|grinding (when|while) (chang|shift)|hard to shift", "GBX-6000"),
    (r"check engine|engine light|ecu|stall(s|ing)?|limp mode", "ECU-8100"),
    (r"screen|infotainment|touch ?screen|music system|android auto|carplay|bluetooth", "INF-2500"),
    (r"speedometer|instrument cluster|dashboard (dead|not working|flicker)|gauges? (dead|not working)", "CLU-1500"),
    (r"window (stuck|not (going|moving)|won'?t)|power window|window motor", "PWM-0340"),
    (r"wiper", "WPR-0260"),
    (r"head ?lamps?|head ?lights?", "HLA-9500"),
    (r"mirror", "MIR-4200"),
    (r"bumper", "BMP-7800"),
    (r"door (dent|damage|panel)|dent(ed)? door|door (is )?damaged", "DRP-1450"),
    (r"brakes? (are |is )?(noisy|noise|squeal\w*|squeak\w*|weak|soft|spongy)|(squeal|squeak|screech)\w* (when|while|on) brak|brake pads?|noise when (i )?brak", "BRK-PAD-F"),
    (r"vibrat\w* (when|while) brak|pulsat|brake discs?|brake rotors?|grinding (when|while) brak", "BRK-DSC-F"),
    (r"steering (is )?(hard|heavy|stiff|loose)|pulls to|steering rack|steering noise", "STR-2400"),
    (r"airbag", "ABG-2100"),
    (r"knock\w* (over|on) (bumps|potholes)|suspension|shock|bumpy|bouncy", "SHK-4800"),
]

SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "One sentence restating the problem in plain words."},
        "parts": {"type": "array", "items": {"type": "object", "properties": {
            "part_id": {"type": "string", "description": "Must be an id from the catalog."},
            "confidence": {"type": "number", "description": "0 to 1"},
            "reason": {"type": "string", "description": "Short: which symptom points to this part."},
        }, "required": ["part_id", "confidence", "reason"]}},
    },
    "required": ["summary", "parts"],
}

SYSTEM = (
    "You are a service-intake assistant at a car dealership. Map the customer's description of "
    "their car problem to the most likely replacement parts from the catalog provided. Only use "
    "part ids from the catalog. Suggest at most 4 parts, most likely first, and only parts the "
    "symptoms really point to. If nothing fits, return an empty list. A technician will inspect "
    "the car and the advisor will confirm, so be honest about confidence."
)


def keyword_match(complaint: str, catalog: list[dict]) -> dict:
    text = complaint.lower()
    ids = {p["id"] for p in catalog}
    names = {p["id"]: p["name"] for p in catalog}
    found: list[dict] = []
    for pattern, pid in KEYWORDS:
        if pid in ids and pid not in {f["part_id"] for f in found}:
            m = re.search(pattern, text)
            if m:
                found.append({"part_id": pid, "confidence": 0.6, "reason": f"mentions “{m.group(0)}”"})
    # Custom catalog parts added by advisors: match on their name.
    for p in catalog:
        if p["id"] not in {f["part_id"] for f in found} and len(p["name"]) > 3 and p["name"].lower() in text:
            found.append({"part_id": p["id"], "confidence": 0.7, "reason": f"mentions “{p['name'].lower()}”"})
    return {
        "summary": complaint.strip()[:200],
        "parts": [{**f, "name": names[f["part_id"]]} for f in found[:4]],
        "mode": "keywords",
    }


def diagnose(complaint: str, vehicle: dict, catalog: list[dict]) -> dict:
    complaint = (complaint or "").strip()
    if not complaint:
        return {"summary": "", "parts": [], "mode": "none"}
    cfg = llm.config()
    if not cfg:
        return keyword_match(complaint, catalog)
    user = {
        "vehicle": {k: vehicle.get(k) for k in ("make_model", "year", "km")},
        "customer_description": complaint[:1500],
        "catalog": [{"id": p["id"], "name": p["name"], "category": p["category"]} for p in catalog],
    }
    try:
        import json
        out = llm.chat_json(SYSTEM, json.dumps(user, ensure_ascii=False), SCHEMA)
        names = {p["id"]: p["name"] for p in catalog}
        parts, seen = [], set()
        for s in out.get("parts") or []:
            pid = str(s.get("part_id", "")).strip()
            if pid in names and pid not in seen:  # guard: catalog ids only
                seen.add(pid)
                try:
                    conf = max(0.0, min(1.0, float(s.get("confidence", 0.5))))
                except (TypeError, ValueError):
                    conf = 0.5
                parts.append({"part_id": pid, "name": names[pid], "confidence": round(conf, 2),
                              "reason": str(s.get("reason", ""))[:160]})
        return {"summary": str(out.get("summary", ""))[:300], "parts": parts[:4], "mode": f"llm:{cfg['provider']}"}
    except Exception as e:
        res = keyword_match(complaint, catalog)
        res["mode"] = f"keywords ({type(e).__name__})"
        return res
