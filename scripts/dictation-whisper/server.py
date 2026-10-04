#!/usr/bin/env python3
"""Local Whisper transcription backend for the portal's voice dictation.

Anthropic's API has no speech-to-text endpoint, so voice input needs a separate
transcription service. This is a tiny, local one: it speaks the exact contract
`lib/dictate/transcribe.ts` expects, so pointing `DICTATION_API_URL` at it makes
the composer mic work with no code change.

Contract:
  POST /            body = raw audio bytes (Content-Type is the clip's mime,
                    e.g. audio/webm); optional `Authorization: Bearer <key>`.
                    Response: 200 {"text": "..."} on success, non-200 {"error"}
                    otherwise.
  GET  /health      200 {"ok": true, "model": "<name>"} for a quick liveness poll.

Transcription runs on-device via faster-whisper (CTranslate2). The audio bytes
are decoded in memory and never written to disk, matching the never-persist
posture of the /api/dictate route that calls this.

Setup:
    cd scripts/dictation-whisper
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    python server.py            # first run downloads the model, then listens

Env (all optional):
    WHISPER_HOST      default 127.0.0.1
    WHISPER_PORT      default 8790
    WHISPER_MODEL     default base.en  (tiny(.en) / base(.en) / small(.en) /
                      medium / large-v3 - .en variants are English-only and faster)
    WHISPER_DEVICE    default cpu      (cpu; cuda if you have an NVIDIA GPU)
    WHISPER_COMPUTE   default int8     (int8 / int8_float16 / float16 / float32)
    WHISPER_API_KEY   if set, require `Authorization: Bearer <key>` (match the
                      portal's DICTATION_API_KEY)
    WHISPER_MAX_BYTES default 26214400 (25 MB) upper bound on a single clip
"""

import io
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from faster_whisper import WhisperModel

HOST = os.environ.get("WHISPER_HOST", "127.0.0.1")
PORT = int(os.environ.get("WHISPER_PORT", "8790"))
MODEL_NAME = os.environ.get("WHISPER_MODEL", "base.en")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
API_KEY = os.environ.get("WHISPER_API_KEY", "")
MAX_BYTES = int(os.environ.get("WHISPER_MAX_BYTES", str(25 * 1024 * 1024)))

print(
    f"[whisper] loading model {MODEL_NAME} ({DEVICE}/{COMPUTE}); first run downloads it...",
    flush=True,
)
_model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)
# CTranslate2 inference is not guaranteed re-entrant, and dictation is
# single-user anyway, so serialize transcription across the threaded server.
_lock = threading.Lock()
print(f"[whisper] ready on http://{HOST}:{PORT} (model={MODEL_NAME})", flush=True)


def transcribe(audio_bytes: bytes) -> str:
    """Decode the in-memory clip and return the joined transcript text."""
    with _lock:
        segments, _info = _model.transcribe(io.BytesIO(audio_bytes), beam_size=1)
        return "".join(segment.text for segment in segments).strip()


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"ok": True, "model": MODEL_NAME})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if API_KEY and self.headers.get("Authorization", "") != f"Bearer {API_KEY}":
            self._json(401, {"error": "unauthorized"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._json(400, {"error": "empty body"})
            return
        if length > MAX_BYTES:
            self._json(413, {"error": "audio too large"})
            return
        audio = self.rfile.read(length)
        try:
            text = transcribe(audio)
        except Exception as exc:  # report, never crash the server on one bad clip
            self._json(500, {"error": f"transcription failed: {exc}"})
            return
        self._json(200, {"text": text})

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[whisper] " + (fmt % args) + "\n")


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except (
        KeyboardInterrupt
    ):  # silent-ok: Ctrl+C is the intended way to stop the server
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
