"""Provider-neutral LLM client for free-tier, OpenAI-compatible chat APIs.

Pick a provider by putting ONE key in backend/.env (or the environment):

    GROQ_API_KEY=...        # https://console.groq.com/keys      (default, fastest)
    GEMINI_API_KEY=...      # https://aistudio.google.com/apikey
    COHERE_API_KEY=...      # https://dashboard.cohere.com/api-keys
    OPENROUTER_API_KEY=...  # https://openrouter.ai/keys          (":free" models)

Optional overrides: LLM_PROVIDER, LLM_MODEL, LLM_BASE_URL, LLM_API_KEY.
No key at all -> callers fall back to deterministic logic, so the app always works.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

ENV_FILE = os.path.join(os.path.dirname(__file__), "..", ".env")

PROVIDERS = {
    "groq": ("GROQ_API_KEY", "https://api.groq.com/openai/v1", "openai/gpt-oss-120b"),
    "gemini": ("GEMINI_API_KEY", "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.0-flash"),
    "cohere": ("COHERE_API_KEY", "https://api.cohere.ai/compatibility/v1", "command-a-03-2025"),
    "openrouter": ("OPENROUTER_API_KEY", "https://openrouter.ai/api/v1", "meta-llama/llama-3.3-70b-instruct:free"),
}


def _load_env_file():
    if not os.path.isfile(ENV_FILE):
        return
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env_file()


def config() -> dict | None:
    """Resolve provider, base URL, model and key. None when no key is configured."""
    forced = os.environ.get("LLM_PROVIDER", "").lower().strip()
    order = [forced] if forced in PROVIDERS else list(PROVIDERS)
    for name in order:
        env_key, base, model = PROVIDERS[name]
        key = os.environ.get(env_key) or (os.environ.get("LLM_API_KEY") if forced == name else None)
        if key:
            return {"provider": name, "key": key,
                    "base_url": os.environ.get("LLM_BASE_URL", base).rstrip("/"),
                    "model": os.environ.get("LLM_MODEL", model)}
    if os.environ.get("LLM_API_KEY") and os.environ.get("LLM_BASE_URL"):  # any other OpenAI-compatible host
        return {"provider": "custom", "key": os.environ["LLM_API_KEY"], "base_url": os.environ["LLM_BASE_URL"].rstrip("/"),
                "model": os.environ.get("LLM_MODEL", "default")}
    return None


def available() -> bool:
    return config() is not None


def info() -> dict:
    c = config()
    if not c:
        return {"mode": "template", "provider": None, "model": None}
    return {"mode": "llm", "provider": c["provider"], "model": _resolved_model.get(c["provider"], c["model"])}


class LLMError(Exception):
    pass


# Preferred chat models, used when the configured one has been retired by the host.
PREFERRED = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen", "llama", "gemini", "command"]
_resolved_model: dict[str, str] = {}


def _pick_available_model(c: dict) -> str | None:
    req = urllib.request.Request(c["base_url"] + "/models", headers={"Authorization": f"Bearer {c['key']}", "User-Agent": "PartWise/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            ids = [m["id"] for m in json.loads(r.read()).get("data", []) if m.get("active", True)]
    except Exception:
        return None
    ids = [i for i in ids if not any(x in i for x in ("whisper", "guard", "orpheus", "tts", "embed"))]
    for pref in PREFERRED:
        for i in ids:
            if i == pref or i.startswith(pref):
                return i
    return ids[0] if ids else None


def _post(c: dict, body: dict) -> dict:
    req = urllib.request.Request(
        c["base_url"] + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {c['key']}",
            "User-Agent": "PartWise/1.0",  # some hosts reject the default urllib agent
        },
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read())


def _extract_json(text: str) -> dict:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    if fence:
        text = fence.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise LLMError("no JSON object in reply")
    return json.loads(text[start:end + 1])


def chat_json(system: str, user: str, schema_hint: dict, temperature: float = 0.2) -> dict:
    """Ask for a JSON object. Uses JSON mode where the host supports it, retries without."""
    c = config()
    if not c:
        raise LLMError("no LLM key configured")
    sys_msg = system + "\n\nReply with ONLY a JSON object matching this JSON schema:\n" + json.dumps(schema_hint)
    model = _resolved_model.get(c["provider"], c["model"])
    body = {
        "model": model,
        "temperature": temperature,
        "max_tokens": 2000,
        "messages": [{"role": "system", "content": sys_msg}, {"role": "user", "content": user}],
        "response_format": {"type": "json_object"},
    }
    if "gpt-oss" in model:
        body["reasoning_effort"] = "low"  # reasoning model: keep it quick and leave tokens for the answer
    try:
        try:
            resp = _post(c, body)
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            # Model retired or not enabled for this key: switch to one the key can use.
            alt = _pick_available_model(c)
            if not alt or alt == model:
                raise
            _resolved_model[c["provider"]] = alt
            body["model"] = alt
            if "gpt-oss" in alt:
                body["reasoning_effort"] = "low"
            else:
                body.pop("reasoning_effort", None)
            resp = _post(c, body)
    except urllib.error.HTTPError as e:
        if e.code != 400:
            raise LLMError(f"HTTP {e.code} from {c['provider']}") from e
        body.pop("response_format")  # host/model without JSON mode
        body.pop("reasoning_effort", None)
        try:
            resp = _post(c, body)
        except urllib.error.HTTPError as e2:
            raise LLMError(f"HTTP {e2.code} from {c['provider']}") from e2
    except (urllib.error.URLError, TimeoutError) as e:
        raise LLMError(f"cannot reach {c['provider']}") from e
    try:
        text = resp["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise LLMError("unexpected response shape") from e
    return _extract_json(text or "")
