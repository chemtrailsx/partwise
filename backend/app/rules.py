"""YAML rules: schema (Pydantic), loading and versioning."""
from __future__ import annotations

import os
from typing import Literal

import yaml
from pydantic import BaseModel, Field, model_validator

DEFAULT_RULES_PATH = os.path.join(os.path.dirname(__file__), "..", "rules", "default.yaml")

GRADE_ORDER = {"A": 3, "B": 2, "C": 1}


class Weights(BaseModel):
    price: float = Field(ge=0, le=1)
    wait: float = Field(ge=0, le=1)
    co2: float = Field(ge=0, le=1)
    warranty: float = Field(ge=0, le=1)
    car_age_fit: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def _not_all_zero(self):
        if self.price + self.wait + self.co2 + self.warranty + self.car_age_fit <= 0:
            raise ValueError("at least one scoring weight must be above 0")
        return self

    def normalized(self) -> dict[str, float]:
        raw = self.model_dump()
        total = sum(raw.values())
        return {k: v / total for k, v in raw.items()}


class Safety(BaseModel):
    new_only_categories: list[str]


class Warranty(BaseModel):
    factory_excluded_categories: list[str] = ["body"]


class Recycled(BaseModel):
    allowed_conditions: list[Literal["remanufactured", "recycled"]]
    min_grade: Literal["A", "B", "C"]
    max_transfer_km: float = Field(gt=0)
    min_warranty_months: int = Field(ge=0)
    require_cheaper: bool = True
    require_greener: bool = True
    young_car_years: float = Field(ge=0)


class Scoring(BaseModel):
    weights: Weights


class Co2(BaseModel):
    remanufactured_factor: float = Field(gt=0, le=1)
    recycled_factor: float = Field(gt=0, le=1)
    transport_kg_per_km: float = Field(ge=0)
    oem_logistics_kg: float = Field(ge=0)


class Logistics(BaseModel):
    same_day_km: float = Field(ge=0)
    oem_order_days: int = Field(ge=0)
    transfer_fee_inr: int = Field(ge=0)


class GreenPoints(BaseModel):
    per_kg_co2: float = Field(ge=0)
    reward_threshold: int = Field(gt=0)
    reward_name: str


class RuleSet(BaseModel):
    version: int = 1
    scope: str
    note: str = ""
    safety: Safety
    warranty: Warranty
    recycled: Recycled
    scoring: Scoring
    co2: Co2
    logistics: Logistics
    green_points: GreenPoints


def parse_rules(text: str) -> RuleSet:
    data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise ValueError("rules must be a YAML mapping")
    return RuleSet.model_validate(data)


def default_rules_text() -> str:
    with open(DEFAULT_RULES_PATH, encoding="utf-8") as f:
        return f.read()


def set_version(text: str, version: int) -> str:
    """Rewrite the top-level `version:` line, keeping comments intact."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("version:"):
            lines[i] = f"version: {version}"
            return "\n".join(lines) + "\n"
    return f"version: {version}\n" + text
