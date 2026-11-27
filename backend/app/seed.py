"""Mock Tekion ARC data: one dealer group, six rooftops, live stock, repair orders.

Everything here is illustrative sample data for the demo. Deterministic (seeded RNG)
so the demo looks the same every time it is reset.
"""
from __future__ import annotations

import json
import random
from datetime import date, datetime, timedelta

from . import db
from .rules import default_rules_text

TODAY = date.today()

ROOFTOPS = [
    # id, name, short, area, lat, lng, is_home
    ("KOR", "Apex Motors Koramangala", "Koramangala", "Bengaluru South", 12.9352, 77.6245, 1),
    ("IND", "Apex Motors Indiranagar", "Indiranagar", "Bengaluru East", 12.9784, 77.6408, 0),
    ("ECY", "Apex Motors Electronic City", "Electronic City", "Bengaluru South", 12.8452, 77.6602, 0),
    ("WFD", "Apex Motors Whitefield", "Whitefield", "Bengaluru East", 12.9698, 77.7500, 0),
    ("YLK", "Apex Motors Yelahanka", "Yelahanka", "Bengaluru North", 13.1007, 77.5963, 0),
    ("HSK", "Apex Motors Hoskote", "Hoskote", "Bengaluru Rural", 13.0707, 77.7982, 0),
]

PARTS = [
    # id, name, category, safety_critical, new_price, new_co2_kg, labor_hours
    ("ALT-2290", "Alternator", "electrical", 0, 8000, 12.5, 1.5),
    ("STM-1180", "Starter motor", "electrical", 0, 6500, 10.0, 1.2),
    ("ACC-5510", "AC compressor", "hvac", 0, 18500, 32.0, 3.0),
    ("RAD-7020", "Radiator", "engine", 0, 7200, 18.0, 2.0),
    ("WPM-3310", "Water pump", "engine", 0, 3200, 6.0, 1.8),
    ("TRB-9900", "Turbocharger", "engine", 0, 42000, 55.0, 4.0),
    ("INJ-4410", "Fuel injector", "engine", 0, 5200, 3.0, 1.0),
    ("GBX-6000", "Manual gearbox", "transmission", 0, 68000, 180.0, 8.0),
    ("ECU-8100", "Engine control unit (ECU)", "electrical", 0, 32000, 22.0, 1.0),
    ("INF-2500", "Infotainment head unit", "electrical", 0, 26000, 28.0, 1.0),
    ("CLU-1500", "Instrument cluster", "electrical", 0, 15500, 14.0, 1.2),
    ("PWM-0340", "Power window motor", "electrical", 0, 3400, 4.0, 1.0),
    ("WPR-0260", "Wiper motor", "electrical", 0, 2600, 3.5, 0.8),
    ("HLA-9500", "Headlamp assembly", "body", 0, 9500, 11.0, 0.8),
    ("MIR-4200", "Side mirror assembly", "body", 0, 4200, 5.0, 0.5),
    ("BMP-7800", "Front bumper", "body", 0, 7800, 14.0, 2.0),
    ("DRP-1450", "Front door panel", "body", 0, 14500, 38.0, 3.5),
    ("BRK-PAD-F", "Brake pads (front set)", "brakes", 1, 2800, 4.0, 1.0),
    ("BRK-DSC-F", "Brake disc (front)", "brakes", 1, 3600, 9.0, 1.2),
    ("STR-2400", "Steering rack", "steering", 1, 24000, 40.0, 4.0),
    ("ABG-2100", "Driver airbag module", "airbags", 1, 21000, 6.0, 1.5),
    ("SHK-4800", "Shock absorber (front)", "suspension", 1, 4800, 7.0, 1.5),
]

CUSTOMERS = [
    ("C1", "Rohan Mehta", "+91 98450 12345", 260),
    ("C2", "Priya Nair", "+91 99001 23456", 90),
    ("C3", "Arjun Rao", "+91 97410 34567", 470),
    ("C4", "Kavya Iyer", "+91 98861 45678", 0),
    ("C5", "Vikram Shetty", "+91 90080 56789", 140),
    ("C6", "Ananya Gupta", "+91 95380 67890", 30),
]


def _d(years: float) -> str:
    return (TODAY + timedelta(days=int(365 * years))).isoformat()


VEHICLES = [
    # id, customer, model, body, year, km, vin, factory_until, ext_active, ext_categories, ext_until
    ("V1", "C1", "Hyundai i20", "hatchback", 2017, 92000, "MALBM51RLHM120034", "2020-03-31", 1, ["hvac", "engine"], _d(0.6)),
    ("V2", "C2", "Honda City", "sedan", 2015, 128000, "MAKGM652FFN301187", "2018-06-30", 0, [], None),
    ("V3", "C3", "Tata Nexon EV", "SUV", 2025, 9000, "MAT628014SPA00412", _d(2.4), 0, [], None),
    ("V4", "C4", "Mahindra Scorpio", "SUV", 2012, 210000, "MA1TB2GXKC2A30881", "2015-01-31", 0, [], None),
    ("V5", "C5", "Maruti Baleno", "hatchback", 2019, 64000, "MA3EWB22SK0312276", "2022-05-31", 1, ["engine", "transmission"], _d(0.9)),
    ("V6", "C6", "Hyundai Creta", "SUV", 2016, 141000, "MALC381CLGM090551", "2019-09-30", 0, [], None),
]

REPAIR_ORDERS = [
    # id, vehicle, advisor, complaint, lines
    ("RO-24817", "V1", "Sneha K.", "Battery warning light, AC not cooling, brake noise",
     [("BRK-PAD-F", "Replace front brake pads"), ("ALT-2290", "Replace alternator"), ("ACC-5510", "Replace AC compressor")]),
    ("RO-24818", "V2", "Sneha K.", "Car won't crank reliably, cracked headlamp, front end knocking",
     [("STM-1180", "Replace starter motor"), ("HLA-9500", "Replace RH headlamp assembly"), ("SHK-4800", "Replace front shock absorber")]),
    ("RO-24819", "V3", "Imran S.", "Mirror broken in parking, screen freezing",
     [("MIR-4200", "Replace LH side mirror"), ("INF-2500", "Replace infotainment head unit")]),
    ("RO-24820", "V4", "Imran S.", "Low power, overheating on highway",
     [("TRB-9900", "Replace turbocharger"), ("RAD-7020", "Replace radiator"), ("WPM-3310", "Replace water pump")]),
    ("RO-24821", "V5", "Deepa R.", "Dent repair after minor collision, window stuck",
     [("DRP-1450", "Replace front LH door panel"), ("PWM-0340", "Replace power window motor")]),
    ("RO-24822", "V6", "Deepa R.", "Gear slipping, vibration while braking",
     [("GBX-6000", "Replace manual gearbox"), ("BRK-DSC-F", "Replace front brake discs")]),
]

# Hand-placed stock so the headline scenarios are exact; random filler is added after.
FIXED_STOCK = [
    # rooftop, part, condition, grade, qty, price, warranty_months, days_in_stock, source
    ("KOR", "BRK-PAD-F", "new", None, 6, 2800, 12, 20, "OEM"),
    ("IND", "BRK-PAD-F", "recycled", "A", 2, 1200, 3, 200, "Trade-in salvage"),
    ("WFD", "ALT-2290", "new", None, 1, 8000, 24, 35, "OEM"),
    ("IND", "ALT-2290", "remanufactured", "A", 1, 4500, 12, 410, "Reman exchange programme"),
    ("ECY", "ALT-2290", "recycled", "C", 1, 2900, 3, 520, "Trade-in salvage"),
    ("HSK", "ALT-2290", "recycled", "B", 1, 3800, 6, 300, "Trade-in salvage"),
    ("KOR", "ACC-5510", "new", None, 2, 18500, 24, 60, "OEM"),
    ("ECY", "ACC-5510", "remanufactured", "A", 1, 11200, 12, 380, "Reman exchange programme"),
    ("KOR", "STM-1180", "new", None, 1, 6500, 24, 15, "OEM"),
    ("ECY", "STM-1180", "remanufactured", "A", 2, 3900, 12, 470, "Reman exchange programme"),
    ("YLK", "HLA-9500", "new", None, 2, 9500, 12, 50, "OEM"),
    ("IND", "HLA-9500", "recycled", "B", 1, 4700, 6, 610, "Insurance write-off"),
    ("KOR", "SHK-4800", "new", None, 4, 4800, 12, 30, "OEM"),
    ("WFD", "SHK-4800", "recycled", "A", 2, 2100, 3, 240, "Trade-in salvage"),
    ("KOR", "MIR-4200", "new", None, 3, 4200, 12, 40, "OEM"),
    ("IND", "MIR-4200", "recycled", "A", 1, 1900, 6, 330, "Insurance write-off"),
    ("KOR", "INF-2500", "new", None, 1, 26000, 24, 80, "OEM"),
    ("WFD", "TRB-9900", "remanufactured", "A", 1, 24500, 12, 450, "Reman exchange programme"),
    ("YLK", "TRB-9900", "recycled", "B", 1, 17000, 6, 700, "Trade-in salvage"),
    ("ECY", "RAD-7020", "recycled", "B", 1, 3100, 6, 390, "Trade-in salvage"),
    ("KOR", "WPM-3310", "new", None, 5, 3200, 12, 25, "OEM"),
    ("IND", "WPM-3310", "recycled", "A", 1, 2950, 3, 120, "Trade-in salvage"),
    ("IND", "DRP-1450", "recycled", "A", 1, 6800, 6, 540, "Insurance write-off"),
    ("WFD", "DRP-1450", "new", None, 1, 14500, 12, 70, "OEM"),
    ("KOR", "PWM-0340", "new", None, 2, 3400, 12, 45, "OEM"),
    ("ECY", "PWM-0340", "recycled", "B", 3, 1500, 6, 400, "Trade-in salvage"),
    ("ECY", "GBX-6000", "remanufactured", "A", 1, 39000, 12, 620, "Reman exchange programme"),
    ("YLK", "GBX-6000", "new", None, 1, 68000, 24, 90, "OEM"),
    ("KOR", "BRK-DSC-F", "new", None, 4, 3600, 12, 35, "OEM"),
    ("ECY", "BRK-DSC-F", "remanufactured", "A", 2, 2000, 6, 260, "Reman exchange programme"),
]

HERO_PARTS = {p for _, p, *_ in FIXED_STOCK}


def seed():
    rng = random.Random(42)
    with db.tx() as c:
        c.executemany("INSERT INTO rooftops VALUES (?,?,?,?,?,?,?)", ROOFTOPS)
        c.executemany("INSERT INTO parts VALUES (?,?,?,?,?,?,?)", PARTS)
        c.executemany("INSERT INTO customers VALUES (?,?,?,?)", CUSTOMERS)
        for v in VEHICLES:
            vv = list(v)
            vv[9] = json.dumps(vv[9])
            c.execute("INSERT INTO vehicles VALUES (?,?,?,?,?,?,?,?,?,?,?)", vv)

        c.executemany(
            "INSERT INTO inventory (rooftop_id, part_id, condition, grade, qty, price, warranty_months, days_in_stock, source) VALUES (?,?,?,?,?,?,?,?,?)",
            FIXED_STOCK,
        )
        # Filler stock across the network for parts not hand-placed (keeps hero scenarios exact)
        roof_ids = [r[0] for r in ROOFTOPS]
        for pid, _name, _cat, safety, price, _co2, _lh in PARTS:
            if pid in HERO_PARTS:
                continue
            for rid in rng.sample(roof_ids, rng.randint(1, 2)):
                c.execute(
                    "INSERT INTO inventory (rooftop_id, part_id, condition, grade, qty, price, warranty_months, days_in_stock, source) VALUES (?,?,?,?,?,?,?,?,?)",
                    (rid, pid, "new", None, rng.randint(1, 4), price, rng.choice([12, 24]), rng.randint(10, 200), "OEM"),
                )
            for rid in rng.sample(roof_ids, rng.randint(1, 3)):
                cond = rng.choice(["recycled", "remanufactured"])
                factor = rng.uniform(0.45, 0.62) if cond == "recycled" else rng.uniform(0.55, 0.72)
                c.execute(
                    "INSERT INTO inventory (rooftop_id, part_id, condition, grade, qty, price, warranty_months, days_in_stock, source) VALUES (?,?,?,?,?,?,?,?,?)",
                    (rid, pid, cond, rng.choice(["A", "A", "B", "B", "C"]), rng.randint(1, 3),
                     int(round(price * factor, -2)), 12 if cond == "remanufactured" else rng.choice([3, 6]),
                     rng.randint(60, 800),
                     "Reman exchange programme" if cond == "remanufactured" else rng.choice(["Trade-in salvage", "Insurance write-off"])),
                )

        created = datetime.now().replace(hour=9, minute=10, second=0, microsecond=0)
        for i, (ro_id, vid, advisor, complaint, lines) in enumerate(REPAIR_ORDERS):
            c.execute(
                "INSERT INTO repair_orders (id, rooftop_id, vehicle_id, advisor, status, complaint, created_at) VALUES (?,?,?,?,?,?,?)",
                (ro_id, "KOR", vid, advisor, "open", complaint,
                 (created + timedelta(minutes=17 * (len(REPAIR_ORDERS) - i))).isoformat(timespec="seconds")),
            )
            for pid, desc in lines:
                c.execute("INSERT INTO ro_lines (ro_id, part_id, labor_desc) VALUES (?,?,?)", (ro_id, pid, desc))

        c.execute(
            "INSERT INTO rules_versions VALUES (?,?,?,?,?)",
            (1, default_rules_text(), db.now(), "system", "Initial pilot policy"),
        )
        _seed_history(c, rng)
        db.audit(c, None, "system", "DEMO_SEEDED", {"rooftops": len(ROOFTOPS), "parts": len(PARTS)})


def _seed_history(c, rng: random.Random):
    """90 days of past PartWise outcomes so the CO2 dashboard has a story to tell."""
    parts = {p[0]: p for p in PARTS}
    non_safety = [p for p in PARTS if not p[3]]
    safety = [p for p in PARTS if p[3]]
    roofs = [r[0] for r in ROOFTOPS]
    for day in range(90, 0, -1):
        d = datetime.now() - timedelta(days=day)
        progress = (90 - day) / 90  # adoption improves through the pilot
        for _ in range(rng.randint(5, 11)):
            roof = rng.choices(roofs, weights=[5, 3, 3, 3, 2, 1])[0]
            r = rng.random()
            if r < 0.18:
                p = rng.choice(safety)
                decision, cond, alt = "NEW_ONLY", "new", 0
            elif r < 0.30:
                p = rng.choice(non_safety)
                decision, cond, alt = "WARRANTY", "new", 0
            else:
                p = rng.choice(non_safety)
                alt = 1 if rng.random() < 0.85 else 0
                uptake = 0.28 + 0.42 * progress
                if alt and rng.random() < uptake:
                    decision = "RECYCLED_RECOMMENDED"
                    cond = rng.choice(["remanufactured", "recycled"])
                else:
                    decision = "RECYCLED_RECOMMENDED" if alt and rng.random() < 0.6 else "NEW_RECOMMENDED"
                    cond = "new"
            pid, _, cat, _, price, co2, _ = parts[p[0]]
            green = cond != "new"
            savings = int(round(price * rng.uniform(0.3, 0.5), -2)) if green else 0
            co2_saved = round(co2 * rng.uniform(0.7, 0.9), 1) if green else 0.0
            wait_saved = float(rng.choice([0, 1, 1, 2, 3])) if green else 0.0
            idle = int(price * rng.uniform(0.4, 0.6)) if green and rng.random() < 0.55 else 0
            fee = 250 if green and rng.random() < 0.8 else 0
            ts = d.replace(hour=rng.randint(9, 18), minute=rng.randint(0, 59), second=0, microsecond=0)
            c.execute(
                "INSERT INTO outcomes (ro_id, line_id, rooftop_id, part_id, category, decision, chosen_condition, had_alternative, savings_inr, co2_saved_kg, wait_days_saved, idle_value_moved, transfer_fee, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (f"RO-{rng.randint(20000, 24700)}", None, roof, pid, cat, decision, cond, alt,
                 savings, co2_saved, wait_saved, idle, fee, ts.isoformat(timespec="seconds")),
            )


def ensure_seeded():
    if not db.row("SELECT 1 AS x FROM rooftops LIMIT 1"):
        seed()
