export type Decision = "NEW_ONLY" | "WARRANTY" | "RECYCLED_RECOMMENDED" | "NEW_RECOMMENDED";
export type Kind = "new" | "remanufactured" | "recycled" | "warranty";

export interface Option {
  id: string;
  inventory_id: number | null;
  condition: "new" | "remanufactured" | "recycled";
  kind: Kind;
  grade: string | null;
  rooftop_id: string | null;
  rooftop: string;
  distance_km: number;
  price: number;
  wait_days: number;
  co2_kg: number;
  warranty_months: number;
  days_in_stock: number;
  source: string;
  qty: number | null;
  age_fit: number;
  eligible: boolean;
  exclusions: string[];
  score: number | null;
  normalized?: Record<string, number>;
  contribution?: Record<string, number>;
  recommended: boolean;
  list_price?: number;
}

export interface RuleHit { rule: string; outcome: string; text: string }

export interface Payload {
  decision: Decision;
  part: { id: string; name: string; category: string; safety_critical: number; new_price: number };
  vehicle: VehicleContext;
  rule_hits: RuleHit[];
  weights: Record<string, number>;
  options: Option[];
  best_new_id: string;
  recommended_id: string;
  savings_inr: number;
  co2_saved_kg: number;
  wait_days_saved: number;
  green_points: number;
  rules_version: number;
  blocked_alternatives: number;
  llm_facts: Record<string, unknown>;
}

export interface Recommendation {
  id: number;
  decision: Decision;
  rules_version: number;
  payload: Payload;
  explanation: { advisor_reason: string; customer_message: string; key_factors: string[] };
  llm_mode: string;
  created_at: string;
}

export interface Line {
  id: number;
  part_id: string;
  part_name: string;
  category: string;
  safety_critical: number;
  new_price: number;
  labor_desc: string;
  labor_hours: number;
  status: string;
  approved_option: string | null;
  override_reason: string | null;
  chosen_option: string | null;
  recommendation: Recommendation | null;
}

export interface VehicleContext {
  age_years: number;
  km: number;
  factory_warranty_active: boolean;
  factory_warranty_until: string;
  ext_warranty_active: boolean;
  ext_warranty_categories: string[];
  ext_warranty_until: string | null;
}

export interface RO {
  id: string;
  status: "open" | "recommended" | "awaiting_customer" | "customer_approved" | "closed";
  advisor: string;
  complaint: string;
  created_at: string;
  customer_token: string | null;
  approved_at: string | null;
  customer_decided_at: string | null;
  source: "arc" | "customer" | null;
  diagnosis: Diagnosis | null;
  vehicle: { id: string; make_model: string; body: string; year: number; km: number; vin: string; context: VehicleContext };
  customer: { id: string; name: string; phone: string; green_points: number };
  rooftop: { id: string; name: string; short: string };
  lines: Line[];
  transfers: { id: number; part_id: string; from_rooftop: string; to_rooftop: string; status: string; fee: number }[];
  sms: { id: number; to_phone: string; body: string; link: string; status: string; created_at: string }[];
}

export interface Diagnosis { summary: string; mode: string; parts: { part_id: string; name: string; confidence: number; reason: string }[] }

export interface Part { id: string; name: string; category: string; safety_critical: number; new_price: number }

export interface ROSummary {
  source: "arc" | "customer" | null;
  id: string;
  status: RO["status"];
  advisor: string;
  complaint: string;
  created_at: string;
  make_model: string;
  year: number;
  km: number;
  customer_name: string;
  parts: string[];
  decisions: Decision[];
  potential_savings: number;
  potential_co2: number;
}

export interface Meta {
  dealer_group: string;
  home: { id: string; name: string; short: string };
  rooftops: { id: string; name: string; short: string; lat: number; lng: number }[];
  llm: { mode: "llm" | "template"; provider: string | null; model: string | null };
  rules_version: number;
  twilio: boolean;
}

export class ApiError extends Error {}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const j = await r.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch { /* keep status text */ }
    throw new ApiError(msg);
  }
  return r.json();
}

export const api = {
  get: <T,>(url: string) => req<T>("GET", url),
  post: <T,>(url: string, body?: unknown) => req<T>("POST", url, body ?? {}),
  put: <T,>(url: string, body: unknown) => req<T>("PUT", url, body),
  del: <T,>(url: string) => req<T>("DELETE", url),
};
