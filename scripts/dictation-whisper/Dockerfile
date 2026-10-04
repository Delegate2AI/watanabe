# syntax=docker/dockerfile:1
FROM python:3.12-slim

# faster-whisper decodes webm/opus clips through PyAV. README.md documents
# ffmpeg as a requirement, so install it rather than rely on PyAV's bundled libs.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Bake the model into the image. Downloading it at pod start would make every
# restart a multi-minute outage and put huggingface.co egress on the serving path.
ENV HF_HOME=/opt/hf \
    WHISPER_MODEL=base.en
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')" \
  && chmod -R a+rX /opt/hf

COPY server.py ./
RUN useradd -u 1001 -m appuser
USER appuser

# 127.0.0.1 (server.py's default) is unreachable from another pod.
ENV WHISPER_HOST=0.0.0.0 \
    WHISPER_PORT=8790
EXPOSE 8790

# -u so the startup and per-request lines reach the pod log unbuffered.
CMD ["python", "-u", "server.py"]
