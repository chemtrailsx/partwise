"""Durable snapshot of the SQLite file in a private Vercel Blob store.

Serverless instances have a throwaway /tmp disk. When BLOB_READ_WRITE_TOKEN is set,
PartWise restores the database from Blob on cold start and uploads a fresh snapshot
after every committed write, so demo data survives restarts and new instances.
Locally (no token) this module does nothing.

Protocol mirrors @vercel/blob 2.x: PUT https://vercel.com/api/blob/?pathname=...
and GET https://<storeId>.private.blob.vercel-storage.com/<pathname>, Bearer token.
"""
from __future__ import annotations

import hashlib
import os
import urllib.error
import urllib.parse
import urllib.request

PATHNAME = os.environ.get("PARTWISE_BLOB_PATH", "partwise/partwise.db")
API = os.environ.get("VERCEL_BLOB_API_URL", "https://vercel.com/api/blob")
_last_hash: str | None = None


def _token() -> str | None:
    t = os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip()
    return t if t.startswith("vercel_blob_rw_") else None


def enabled() -> bool:
    return _token() is not None


def _store_id(token: str) -> str:
    return token.split("_")[3]


def download(dest: str) -> bool:
    """Fetch the snapshot into `dest`. False when there is none yet."""
    global _last_hash
    token = _token()
    if not token:
        return False
    url = f"https://{_store_id(token)}.private.blob.vercel-storage.com/{PATHNAME}?cache=0"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "User-Agent": "PartWise/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        raise
    if not data.startswith(b"SQLite format 3"):
        return False
    tmp = dest + ".dl"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, dest)
    _last_hash = hashlib.sha256(data).hexdigest()
    return True


def upload(path: str) -> None:
    """Upload the database file if it changed since the last sync."""
    global _last_hash
    token = _token()
    if not token or not os.path.exists(path):
        return
    with open(path, "rb") as f:
        data = f.read()
    h = hashlib.sha256(data).hexdigest()
    if h == _last_hash:
        return
    url = API + "/?" + urllib.parse.urlencode({"pathname": PATHNAME})
    req = urllib.request.Request(url, data=data, method="PUT", headers={
        "Authorization": f"Bearer {token}",
        "x-api-version": "12",
        "x-vercel-blob-access": "private",
        "x-allow-overwrite": "1",
        "x-add-random-suffix": "0",
        "x-content-type": "application/octet-stream",
        "x-content-length": str(len(data)),
        "User-Agent": "PartWise/1.0",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        r.read()
    _last_hash = h
