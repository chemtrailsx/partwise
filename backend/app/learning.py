"""Learn scoring weights from what customers actually accept.

Every time a customer is offered a recycled/remanufactured part next to a new one, we
record how much better (or worse) the green option was on each scoring factor, and
whether they took it. A small L2-regularised logistic regression (NumPy) estimates how
strongly each factor drives acceptance. Those strengths become suggested weights,
blended with the current policy in proportion to how much evidence there is.
The dealer reviews and publishes them as a new rules version; nothing changes silently.
"""
from __future__ import annotations

import json

import numpy as np

from . import db

FEATURES = ["price", "wait", "co2", "warranty", "car_age_fit"]
LABELS = {"price": "Price", "wait": "Wait time", "co2": "CO₂", "warranty": "Warranty", "car_age_fit": "Car-age fit"}
PRIOR_STRENGTH = 300  # decisions needed before learned weights count as much as the current policy
MIN_DECISIONS = 30


def decision_features(green: dict, new: dict) -> dict:
    """How much better the green option is than new, per factor, on comparable scales."""
    return {
        "price": round((new["price"] - green["price"]) / max(new["price"], 1), 4),
        "wait": round(float(np.clip((new["wait_days"] - green["wait_days"]) / 3, -1, 1)), 4),
        "co2": round((new["co2_kg"] - green["co2_kg"]) / max(new["co2_kg"], 1e-6), 4),
        "warranty": round((green["warranty_months"] - new["warranty_months"]) / 24, 4),
        "car_age_fit": round(green.get("age_fit", 0.5) - new.get("age_fit", 0.5), 4),
    }


def _fit(X: np.ndarray, y: np.ndarray, l2: float = 1.0, iters: int = 30):
    """Logistic regression by Newton's method (IRLS) on standardised features.

    Returns (intercept, per-factor effect of a one-standard-deviation change, fitted probabilities).
    """
    mu, sd = X.mean(axis=0), X.std(axis=0)
    sd = np.where(sd == 0, 1.0, sd)
    Z = np.hstack([np.ones((len(X), 1)), (X - mu) / sd])
    w = np.zeros(Z.shape[1])
    reg = np.eye(Z.shape[1]) * l2
    reg[0, 0] = 0.0  # don't shrink the intercept
    for _ in range(iters):
        p = 1 / (1 + np.exp(-Z @ w))
        grad = Z.T @ (p - y) + reg @ w
        H = Z.T @ (Z * (p * (1 - p))[:, None]) + reg
        step = np.linalg.solve(H, grad)
        w -= step
        if np.abs(step).max() < 1e-8:
            break
    p = 1 / (1 + np.exp(-Z @ w))
    return w[0], w[1:], p


def analyse(current_weights: dict[str, float]) -> dict:
    rows = db.rows("SELECT features, accepted, ro_id, line_id FROM outcomes WHERE accepted IS NOT NULL AND features IS NOT NULL")
    n = len(rows)
    live = sum(1 for r in rows if r["line_id"] is not None)
    cur = {f: current_weights[f] for f in FEATURES}
    base = {"n": n, "live_decisions": live, "simulated_decisions": n - live, "current_weights": cur,
            "labels": LABELS, "min_decisions": MIN_DECISIONS}
    if n < MIN_DECISIONS:
        return {**base, "ready": False}

    X = np.array([[json.loads(r["features"])[f] for f in FEATURES] for r in rows], dtype=float)
    y = np.array([r["accepted"] for r in rows], dtype=float)
    bias, coef, p = _fit(X, y)

    # coef is already "effect of a typical (1 SD) difference" because features were standardised.
    importance = np.maximum(coef, 0)
    learned = importance / importance.sum() if importance.sum() > 0 else np.array([cur[f] for f in FEATURES])
    alpha = n / (n + PRIOR_STRENGTH)
    cur_v = np.array([cur[f] for f in FEATURES])
    blended = (1 - alpha) * cur_v + alpha * learned
    blended = blended / blended.sum()
    # CO2 is a policy goal, not only a customer preference: learning never lowers its weight.
    ci = FEATURES.index("co2")
    co2_floor = cur_v[ci]
    if blended[ci] < co2_floor:
        others = np.delete(np.arange(len(FEATURES)), ci)
        rest = blended[others]
        blended[others] = rest / rest.sum() * (1 - co2_floor) if rest.sum() > 0 else (1 - co2_floor) / len(others)
        blended[ci] = co2_floor

    accuracy = float(((p >= 0.5) == (y == 1)).mean())
    baseline = float(max(y.mean(), 1 - y.mean()))
    insights = []
    ratio = {f: (learned[i] / cur_v[i]) if cur_v[i] > 0 else None for i, f in enumerate(FEATURES)}
    for f, r in sorted(ratio.items(), key=lambda kv: -(kv[1] or 0)):
        if r and r >= 1.3:
            insights.append(f"Customers weigh {LABELS[f].lower()} about {r:.1f}× more than the current policy assumes.")
    for f, r in sorted(ratio.items(), key=lambda kv: (kv[1] if kv[1] is not None else 9)):
        if r is not None and r <= 0.7:
            insights.append(f"{LABELS[f]} drives acceptance less than the policy assumes ({r:.1f}×).")
    return {
        **base, "ready": True,
        "acceptance_rate": round(float(y.mean()), 3),
        "coefficients": {f: round(float(c), 3) for f, c in zip(FEATURES, coef)},
        "intercept": round(float(bias), 3),
        "learned_weights": {f: round(float(v), 3) for f, v in zip(FEATURES, learned)},
        "suggested_weights": {f: round(float(v), 3) for f, v in zip(FEATURES, blended)},
        "evidence_share": round(alpha, 3),
        "co2_floor": round(float(co2_floor), 3),
        "accuracy": round(accuracy, 3),
        "baseline_accuracy": round(baseline, 3),
        "insights": insights[:3],
    }
