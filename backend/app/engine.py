"""PartWise decision engine: stock search -> rules engine -> NumPy scoring.

The engine is deterministic. The LLM never makes the decision; it only explains it.
"""
from __future__ import annotations

import json
import math
from datetime import date

import numpy as np

from . import db
from .rules import GRADE_ORDER, RuleSet

ROAD_FACTOR = 1.5  # straight-line -> approximate road distance in Bengaluru traffic
FEATURES = ["price", "wait", "co2", "warranty", "car_age_fit"]


def road_km(a: dict, b: dict) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (a["lat"], a["lng"], b["lat"], b["lng"]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return round(2 * 6371 * math.asin(math.sqrt(h)) * ROAD_FACTOR, 1)


def vehicle_context(v: dict) -> dict:
    today = date.today()
    age = round(today.year - v["year"] + (today.month - 6) / 12, 1)  # assume mid-year registration
    factory_active = date.fromisoformat(v["factory_warranty_until"]) >= today
    ext_until = v.get("ext_warranty_until")
    ext_active = bool(v["ext_warranty_active"]) and bool(ext_until) and date.fromisoformat(ext_until) >= today
    cats = v["ext_warranty_categories"]
    if isinstance(cats, str):
        cats = json.loads(cats or "[]")
    return {
        "age_years": max(age, 0.0),
        "km": v["km"],
        "factory_warranty_active": factory_active,
        "factory_warranty_until": v["factory_warranty_until"],
        "ext_warranty_active": ext_active,
        "ext_warranty_categories": cats,
        "ext_warranty_until": ext_until,
    }


def _wait_days(km: float, is_home: bool, rules: RuleSet) -> int:
    if is_home:
        return 0
    return 0 if km <= rules.logistics.same_day_km else 1


def _co2(part: dict, condition: str, km: float, rules: RuleSet, oem_order: bool = False) -> float:
    base = part["new_co2_kg"]
    if condition == "remanufactured":
        base *= rules.co2.remanufactured_factor
    elif condition == "recycled":
        base *= rules.co2.recycled_factor
    transport = km * rules.co2.transport_kg_per_km
    if oem_order:
        transport += rules.co2.oem_logistics_kg
    return round(base + transport, 2)


def _age_fit(condition: str, age: float) -> float:
    """How well a part's expected life matches the car's remaining life."""
    if condition == "new":
        return float(np.clip(1 - (age - 3) / 12, 0.4, 1.0))
    return float(np.clip(age / 8, 0.15, 1.0))


def gather_options(part: dict, home: dict, rooftops: list[dict], vctx: dict, rules: RuleSet) -> tuple[dict, list[dict]]:
    """Stock search across every rooftop. Returns (best_new, used_candidates)."""
    stock = db.rows("SELECT * FROM inventory WHERE part_id=? AND qty>0", (part["id"],))
    roofs = {r["id"]: r for r in rooftops}
    new_opts, used = [], []
    for s in stock:
        r = roofs[s["rooftop_id"]]
        km = 0.0 if r["id"] == home["id"] else road_km(home, r)
        opt = {
            "id": f"inv-{s['id']}",
            "inventory_id": s["id"],
            "condition": s["condition"],
            "grade": s["grade"],
            "rooftop_id": r["id"],
            "rooftop": r["short"],
            "distance_km": km,
            "price": s["price"],
            "wait_days": _wait_days(km, r["id"] == home["id"], rules),
            "co2_kg": _co2(part, s["condition"], km, rules),
            "warranty_months": s["warranty_months"],
            "days_in_stock": s["days_in_stock"],
            "source": s["source"],
            "qty": s["qty"],
        }
        (new_opts if s["condition"] == "new" else used).append(opt)

    # A factory order is always possible.
    new_opts.append({
        "id": f"oem-{part['id']}",
        "inventory_id": None,
        "condition": "new",
        "grade": None,
        "rooftop_id": None,
        "rooftop": "OEM factory order",
        "distance_km": 0.0,
        "price": part["new_price"],
        "wait_days": rules.logistics.oem_order_days,
        "co2_kg": _co2(part, "new", 0, rules, oem_order=True),
        "warranty_months": 24,
        "days_in_stock": 0,
        "source": "OEM",
        "qty": None,
    })
    best_new = min(new_opts, key=lambda o: (o["wait_days"], o["distance_km"], o["price"]))
    for o in [best_new, *used]:
        o["age_fit"] = round(_age_fit(o["condition"], vctx["age_years"]), 3)
    return best_new, used


def check_eligibility(opt: dict, best_new: dict, vctx: dict, rules: RuleSet) -> list[str]:
    rr = rules.recycled
    reasons = []
    if opt["condition"] not in rr.allowed_conditions:
        reasons.append(f"{opt['condition']} parts not allowed by policy")
    if vctx["age_years"] < rr.young_car_years:
        reasons.append(f"car is under {rr.young_car_years:g} years old: new-part policy")
    if opt["grade"] and GRADE_ORDER[opt["grade"]] < GRADE_ORDER[rr.min_grade]:
        reasons.append(f"grade {opt['grade']} is below minimum grade {rr.min_grade}")
    if opt["distance_km"] > rr.max_transfer_km:
        reasons.append(f"{opt['distance_km']:.0f} km away, over the {rr.max_transfer_km:g} km transfer limit")
    if opt["warranty_months"] < rr.min_warranty_months:
        reasons.append(f"{opt['warranty_months']}-month warranty, under the {rr.min_warranty_months}-month minimum")
    if rr.require_cheaper and opt["price"] >= best_new["price"]:
        reasons.append("not cheaper than new")
    if rr.require_greener and opt["co2_kg"] >= best_new["co2_kg"]:
        reasons.append("not greener than new")
    return reasons


def score(options: list[dict], weights: dict[str, float]) -> None:
    """Min-max normalise each feature across the candidate set, then weighted sum (0-100)."""
    if not options:
        return
    m = np.array([[o["price"], o["wait_days"], o["co2_kg"], o["warranty_months"], o["age_fit"]] for o in options], dtype=float)
    lo, hi = m.min(axis=0), m.max(axis=0)
    span = np.where(hi - lo == 0, 1.0, hi - lo)
    norm = (m - lo) / span
    norm[:, [0, 1, 2]] = 1 - norm[:, [0, 1, 2]]  # lower price/wait/CO2 is better
    norm[:, (hi - lo) == 0] = 1.0                # a tie gives full marks to everyone
    w = np.array([weights[f] for f in FEATURES])
    totals = norm @ w * 100
    for o, n, t in zip(options, norm, totals):
        o["normalized"] = {f: round(float(x), 3) for f, x in zip(FEATURES, n)}
        o["contribution"] = {f: round(float(x * weights[f] * 100), 1) for f, x in zip(FEATURES, n)}
        o["score"] = round(float(t), 1)


def analyze_line(part: dict, vehicle: dict, home: dict, rooftops: list[dict], rules: RuleSet,
                 weights_override: dict | None = None) -> dict:
    vctx = vehicle_context(vehicle)
    weights = weights_override or rules.scoring.weights.normalized()
    best_new, used = gather_options(part, home, rooftops, vctx, rules)
    hits: list[dict] = []
    is_safety = bool(part["safety_critical"]) or part["category"] in rules.safety.new_only_categories

    # ---- 1. Rules engine -------------------------------------------------
    decision = None
    if is_safety:
        hits.append({"rule": "SAFETY-01", "outcome": "new_only",
                     "text": f"'{part['category']}' is a safety-critical category: only a new part is allowed"})
        decision = "NEW_ONLY"
    elif vctx["factory_warranty_active"] and part["category"] not in rules.warranty.factory_excluded_categories:
        hits.append({"rule": "WAR-01", "outcome": "warranty",
                     "text": f"Factory warranty active until {vctx['factory_warranty_until']}: warranty-approved part at ₹0"})
        decision = "WARRANTY"
    elif vctx["ext_warranty_active"] and part["category"] in vctx["ext_warranty_categories"]:
        hits.append({"rule": "WAR-02", "outcome": "warranty",
                     "text": f"Extended warranty covers '{part['category']}' until {vctx['ext_warranty_until']}: warranty-approved part at ₹0"})
        decision = "WARRANTY"
    else:
        hits.append({"rule": "SAFETY-01", "outcome": "pass", "text": "Not a safety-critical part"})
        hits.append({"rule": "WAR-01/02", "outcome": "pass", "text": "Not covered by any active warranty"})

    # ---- 2. Eligibility of recycled / remanufactured stock --------------
    for o in used:
        o["exclusions"] = ["safety-critical part: recycled not permitted"] if is_safety else (
            ["covered by warranty: OEM-approved part used"] if decision == "WARRANTY" else
            check_eligibility(o, best_new, vctx, rules))
        o["eligible"] = not o["exclusions"]
    best_new["exclusions"], best_new["eligible"] = [], True

    if decision == "WARRANTY":
        best_new = {**best_new, "id": "warranty", "price": 0, "customer_pays": 0, "warranty_claim": True,
                    "list_price": part["new_price"]}

    candidates = [best_new] + [o for o in used if o["eligible"]]
    score(candidates, weights)

    # ---- 3. Pick ---------------------------------------------------------
    if decision in ("NEW_ONLY", "WARRANTY"):
        pick = best_new
    else:
        pick = max(candidates, key=lambda o: o["score"])
        decision = "RECYCLED_RECOMMENDED" if pick["condition"] != "new" else "NEW_RECOMMENDED"
        if not any(o["eligible"] for o in used):
            hits.append({"rule": "STOCK-01", "outcome": "no_alternative",
                         "text": "No eligible recycled or remanufactured part in the network"})
        elif pick["condition"] == "new":
            hits.append({"rule": "SCORE-01", "outcome": "new_scored_higher",
                         "text": "Eligible alternatives exist but the new part scored higher"})
        else:
            hits.append({"rule": "SCORE-01", "outcome": "recycled_wins",
                         "text": f"{pick['condition'].capitalize()} part scored {pick['score']} vs new {best_new['score']}"})

    options = [best_new] + used
    for o in options:
        o["recommended"] = o["id"] == pick["id"]
        o.setdefault("score", None)
        o["kind"] = "warranty" if o.get("warranty_claim") else o["condition"]

    savings = (best_new["price"] - pick["price"]) if pick is not best_new else 0
    co2_saved = round(best_new["co2_kg"] - pick["co2_kg"], 1) if pick is not best_new else 0.0
    wait_saved = best_new["wait_days"] - pick["wait_days"] if pick is not best_new else 0
    pts = int(round(co2_saved * rules.green_points.per_kg_co2 / 10.0) * 10) if co2_saved > 0 else 0

    return {
        "decision": decision,
        "part": {k: part[k] for k in ("id", "name", "category", "safety_critical", "new_price")},
        "vehicle": vctx,
        "rule_hits": hits,
        "weights": weights,
        "options": options,
        "best_new_id": best_new["id"],
        "recommended_id": pick["id"],
        "savings_inr": savings,
        "co2_saved_kg": co2_saved,
        "wait_days_saved": wait_saved,
        "green_points": pts,
        "rules_version": rules.version,
        "blocked_alternatives": sum(1 for o in used if not o["eligible"]),
    }


def option_by_id(payload: dict, option_id: str) -> dict | None:
    return next((o for o in payload["options"] if o["id"] == option_id), None)


def impact_of(payload: dict, option_id: str, rules: RuleSet) -> dict:
    """Savings / CO2 / points if the customer ends up with `option_id`."""
    opt = option_by_id(payload, option_id)
    new = option_by_id(payload, payload["best_new_id"])
    if opt is None or new is None or opt["id"] == new["id"]:
        return {"savings_inr": 0, "co2_saved_kg": 0.0, "wait_days_saved": 0, "green_points": 0}
    co2 = round(new["co2_kg"] - opt["co2_kg"], 1)
    return {
        "savings_inr": new["price"] - opt["price"],
        "co2_saved_kg": co2,
        "wait_days_saved": new["wait_days"] - opt["wait_days"],
        "green_points": int(round(co2 * rules.green_points.per_kg_co2 / 10.0) * 10) if co2 > 0 else 0,
    }
