# Local Whisper dictation backend

A tiny, on-device speech-to-text service for the portal's composer mic. The
Anthropic API has no transcription endpoint, so voice input needs a separate
backend; this one runs [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
locally and speaks the exact contract `lib/dictate/transcribe.ts` expects, so no
app code changes are needed to use it.

Audio is decoded in memory and never written to disk, matching the never-persist
posture of the `/api/dictate` route that calls it.

## Setup

Requires Python 3.9+ and `ffmpeg` on your PATH (used to decode webm/opus).

```sh
cd scripts/dictation-whisper
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

The first run downloads the model (default `base.en`, about 140 MB) and then
listens on `http://127.0.0.1:8790`. Leave it running in its own terminal.

Quick liveness check:

```sh
curl http://127.0.0.1:8790/health
# {"ok": true, "model": "base.en"}
```

## Wire it into the portal

In `.env.local`, turn dictation on and point it at the server:

```sh
DICTATION_ENABLED=1
DICTATION_API_URL=http://127.0.0.1:8790
# DICTATION_API_KEY=...    # optional; if set, also set WHISPER_API_KEY to match
```

Restart `pnpm dev` so the new env is picked up. The composer mic then becomes
active on Home, `/chat/[id]`, `/projects/[id]`, and the `/embed` chat.

## In the cluster

The same server runs in stage and prod, so the deployed portal gets the same mic
the local one does. `Dockerfile` here builds it with the model baked in;
`helm/depends/dictation-whisper.yaml` is the Deployment plus a ClusterIP Service
named `dictation-whisper` on port 8790, applied out-of-band by the deploy job
(`.portal-apply-dictation` in `.gitlab-ci.yml`) the same way the PVC is. Each
env's values file then sets:

```yaml
DICTATION_ENABLED: "1"
DICTATION_API_URL: "http://dictation-whisper:8790"
```

Both lines are required. `DICTATION_ENABLED` alone leaves `isDictationEnabled()`
false and the mic disabled, which is how the feature sat unusable in both envs
after spec 24 shipped. `lib/dictate/deploy-config.test.ts` fails the build if a
future env file sets one without the other.

`DICTATION_API_KEY` is unset in-cluster: the Service is ClusterIP-only, so the
portal pod is the only thing that can reach it. Set it (with `WHISPER_API_KEY` to
match) if the backend is ever exposed more widely.

Changing the model means changing it in two places, `WHISPER_MODEL` in the
Dockerfile (which decides what gets baked in) and in the Deployment's env. If
they disagree the container downloads the second model at start, which is slow
and needs egress to huggingface.co.

## Configuration

All optional, via environment variables:

| Var | Default | Notes |
| --- | --- | --- |
| `WHISPER_HOST` | `127.0.0.1` | Bind address |
| `WHISPER_PORT` | `8790` | Port |
| `WHISPER_MODEL` | `base.en` | `tiny(.en)` / `base(.en)` / `small(.en)` / `medium` / `large-v3`. The `.en` variants are English-only and faster; drop the suffix for multilingual |
| `WHISPER_DEVICE` | `cpu` | `cuda` if you have an NVIDIA GPU |
| `WHISPER_COMPUTE` | `int8` | `int8` / `int8_float16` / `float16` / `float32` |
| `WHISPER_API_KEY` | (unset) | If set, require `Authorization: Bearer <key>`; match the portal's `DICTATION_API_KEY` |
| `WHISPER_MAX_BYTES` | `26214400` | Reject a clip larger than this (25 MB) |

Bigger models are more accurate but slower; `base.en` is a good balance for
short dictation clips on a laptop CPU.
