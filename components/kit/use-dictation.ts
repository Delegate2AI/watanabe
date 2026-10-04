"use client";

import { useCallback, useRef, useState } from "react";
import { messageForBody } from "@/lib/errors/messages";

/**
 * Voice-dictation capture for the composer (spec 24). Records from the mic with
 * `MediaRecorder`, then POSTs the clip to `/api/dictate` and hands the returned
 * text back via `onText` so the composer can insert it. Purely an input aid: it
 * never sends the message, and the browser holds no audio once the upload
 * resolves.
 *
 * Fails soft: a missing `MediaRecorder`/`getUserMedia` (unsupported browser or a
 * denied permission) sets `error` rather than throwing, so the mic degrades
 * gracefully instead of breaking the composer.
 */
export function useDictation(onText: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Dictation is not supported in this browser.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await media.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was denied.");
      return;
    }
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      for (const track of stream.getTracks()) track.stop();
      setRecording(false);
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      if (blob.size === 0) return;
      setBusy(true);
      try {
        const form = new FormData();
        form.set("audio", blob, "clip.webm");
        const res = await fetch("/api/dictate", { method: "POST", body: form });
        const body = (await res.json().catch(() => null)) as { text?: string } | null;
        if (res.ok && body?.text) onText(body.text);
        else setError(messageForBody(body));
      } catch {
        setError("Could not transcribe audio.");
      } finally {
        setBusy(false);
      }
    };
    recorder.start();
    setRecording(true);
  }, [onText]);

  const toggle = useCallback(() => {
    if (recording) stop();
    else void start();
  }, [recording, start, stop]);

  return { recording, busy, error, toggle };
}
