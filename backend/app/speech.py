"""Voice booking: customer's voice note -> text (any language) + English translation.

Uses Groq's free Whisper endpoints (same GROQ_API_KEY as the LLM):
  /audio/transcriptions  whisper-large-v3-turbo  (keeps the customer's own words and language)
  /audio/translations    whisper-large-v3        (English version, only when not spoken in English)
The audio goes only to the speech model; it is not stored.
"""
from __future__ import annotations

import json
import secrets
import urllib.error
import urllib.request

from . import llm

MAX_BYTES = 4_000_000  # ~4 MB keeps us under serverless request limits (about 2-4 min of opus audio)
EXT = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a"}


class SpeechError(Exception):
    pass


def available() -> bool:
    c = llm.config()
    return bool(c and c["provider"] == "groq")


def _multipart(fields: dict[str, str], filename: str, content_type: str, data: bytes) -> tuple[bytes, str]:
    boundary = "----partwise" + secrets.token_hex(12)
    parts = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n".encode() + data + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), boundary


def _call(endpoint: str, fields: dict[str, str], audio: bytes, content_type: str) -> dict:
    c = llm.config()
    ext = EXT.get(content_type.split(";")[0].strip(), "webm")
    body, boundary = _multipart(fields, f"voice.{ext}", content_type.split(";")[0].strip() or "audio/webm", audio)
    req = urllib.request.Request(
        c["base_url"] + endpoint, data=body, method="POST",
        headers={"Authorization": f"Bearer {c['key']}", "Content-Type": f"multipart/form-data; boundary={boundary}",
                 "User-Agent": "PartWise/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode("utf-8", "replace")
        raise SpeechError(f"speech service returned HTTP {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise SpeechError("cannot reach the speech service") from e


def transcribe(audio: bytes, content_type: str) -> dict:
    if not available():
        raise SpeechError("voice needs a Groq key")
    if len(audio) < 1000:
        raise SpeechError("recording is too short")
    if len(audio) > MAX_BYTES:
        raise SpeechError("recording is too long; keep it under about 2 minutes")
    prompt = "Car service booking in India. Customer describes a car problem: AC, brakes, battery, starter, headlight, clutch, gearbox."
    t = _call("/audio/transcriptions",
              {"model": "whisper-large-v3-turbo", "response_format": "verbose_json", "temperature": "0", "prompt": prompt},
              audio, content_type)
    text = (t.get("text") or "").strip()
    lang = (t.get("language") or "").strip().lower()
    english = text
    if text and lang not in ("", "en", "english"):
        tr = _call("/audio/translations",
                   {"model": "whisper-large-v3", "response_format": "json", "temperature": "0"}, audio, content_type)
        english = (tr.get("text") or "").strip() or text
    return {"text": text, "language": lang or "unknown", "english": english,
            "duration_s": round(float(t.get("duration") or 0), 1)}
